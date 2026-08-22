package upstream

import (
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/relaxdiego/dvo-reports/backend/internal/report"
)

// call is one request the fake city received.
type call struct {
	Path   string
	Query  map[string]string
	Fields map[string]string
	Photos []string
}

// fakeCity stands in for reports.davaocity.gov.ph. reply is consulted per
// request, in order.
type fakeCity struct {
	t       *testing.T
	replies []string
	calls   []call
	srv     *httptest.Server
	// status is the HTTP status every reply carries. Zero means 200. The
	// city refuses some things with a 4xx and a body that says why.
	status int
}

func newFakeCity(t *testing.T, replies ...string) *fakeCity {
	t.Helper()
	f := &fakeCity{t: t, replies: replies}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeCity) serve(w http.ResponseWriter, r *http.Request) {
	c := call{Path: strings.TrimPrefix(r.URL.Path, "/"), Query: map[string]string{}, Fields: map[string]string{}}
	for k := range r.URL.Query() {
		c.Query[k] = r.URL.Query().Get(k)
	}
	if ct := r.Header.Get("Content-Type"); strings.HasPrefix(ct, "multipart/") {
		_, params, err := mime.ParseMediaType(ct)
		if err != nil {
			f.t.Fatal(err)
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				f.t.Fatal(err)
			}
			body, _ := io.ReadAll(part)
			if part.FileName() != "" {
				c.Photos = append(c.Photos, part.FileName()+":"+string(body))
			} else {
				c.Fields[part.FormName()] = string(body)
			}
		}
	}
	f.calls = append(f.calls, c)

	reply := "{}"
	if len(f.calls) <= len(f.replies) {
		reply = f.replies[len(f.calls)-1]
	}
	w.Header().Set("Content-Type", "application/json")
	if f.status != 0 {
		w.WriteHeader(f.status)
	}
	io.WriteString(w, reply)
}

func (f *fakeCity) client() *City { return &City{BaseURL: f.srv.URL, HTTP: f.srv.Client()} }

func goodReport() report.Report {
	return report.Report{
		Category:    "pothole",
		Description: "Deep pothole in the outer lane near the corner.",
		Address:     "Quimpo Blvd, Davao City",
		Lat:         7.0731,
		Lon:         125.6128,
	}
}

// A report without photos is one request, and the reference is the city's
// control number.
func TestSubmitWithoutPhotosSendsOneRequest(t *testing.T) {
	city := newFakeCity(t, `{"controlno":"DCR-2026-0001"}`)

	got, err := city.client().Submit(context.Background(), goodReport(), "tk-1")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got.Reference != "DCR-2026-0001" {
		t.Errorf("reference %q", got.Reference)
	}
	if len(city.calls) != 1 {
		t.Fatalf("want 1 request, got %d", len(city.calls))
	}
	c := city.calls[0]
	if c.Path != "complainController" {
		t.Errorf("path %q", c.Path)
	}
	if c.Fields["trans"] != "ADD" || c.Fields["xtk"] != "tk-1" || c.Fields["contno"] != "" {
		t.Errorf("fields %+v", c.Fields)
	}
	if c.Fields["complain"] != goodReport().Description {
		t.Errorf("complain %q", c.Fields["complain"])
	}
	if c.Fields["location"] != "Quimpo Blvd, Davao City" {
		t.Errorf("location %q", c.Fields["location"])
	}
	if c.Fields["coordinates"] != "7.0731,125.6128" {
		t.Errorf("coordinates %q", c.Fields["coordinates"])
	}
}

// The city needs two requests when there are photos, and the caller must not
// have to know that.
func TestSubmitWithPhotosAttachesOnASecondRequest(t *testing.T) {
	city := newFakeCity(t, `{"controlno":"DCR-2026-0002"}`, `{"controlno":"DCR-2026-0002"}`)
	r := goodReport()
	r.Photos = []report.Photo{{Filename: "a.gif", MediaType: "image/gif", Data: []byte("GIF89a")}}

	got, err := city.client().Submit(context.Background(), r, "tk-1")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got.Reference != "DCR-2026-0002" {
		t.Errorf("reference %q", got.Reference)
	}
	if len(city.calls) != 2 {
		t.Fatalf("want 2 requests, got %d", len(city.calls))
	}
	if city.calls[0].Fields["trans"] != "ADD" || len(city.calls[0].Photos) != 0 {
		t.Errorf("first request should be a bare ADD: %+v", city.calls[0])
	}
	second := city.calls[1]
	if second.Fields["trans"] != "ATTACH" || second.Fields["contno"] != "DCR-2026-0002" {
		t.Errorf("second request %+v", second.Fields)
	}
	if len(second.Photos) != 1 || second.Photos[0] != "a.gif:GIF89a" {
		t.Errorf("photos %v", second.Photos)
	}
}

// The report is already filed at this point. Reporting a total failure would
// tell the citizen a lie.
func TestSubmitKeepsTheReferenceWhenPhotosFail(t *testing.T) {
	city := newFakeCity(t, `{"controlno":"DCR-2026-0003"}`, `{"message":"attachment rejected"}`)
	r := goodReport()
	r.Photos = []report.Photo{{Filename: "a.gif", MediaType: "image/gif", Data: []byte("GIF89a")}}

	got, err := city.client().Submit(context.Background(), r, "tk-1")
	if !errors.Is(err, ErrPhotosNotAttached) {
		t.Fatalf("want ErrPhotosNotAttached, got %v", err)
	}
	if got.Reference != "DCR-2026-0003" {
		t.Errorf("reference %q, want the real one", got.Reference)
	}
}

func TestSubmitReportsAnExpiredSession(t *testing.T) {
	city := newFakeCity(t, `{"isValid":false}`)

	if _, err := city.client().Submit(context.Background(), goodReport(), "stale"); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("want ErrSessionExpired, got %v", err)
	}
}

func TestSubmitFailsWhenTheCityReturnsNoControlNumber(t *testing.T) {
	city := newFakeCity(t, `{}`)

	if _, err := city.client().Submit(context.Background(), goodReport(), "tk-1"); err == nil {
		t.Fatal("want an error, got nil")
	}
}

// The city has been seen to answer with HTML. That must be an error, not a
// silent success.
func TestSubmitFailsOnANonJSONReply(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, "<html>ORA-06512</html>")
	}))
	defer srv.Close()
	c := &City{BaseURL: srv.URL, HTTP: srv.Client()}

	_, err := c.Submit(context.Background(), goodReport(), "tk-1")
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	// The detail belongs in the log, so it has to survive in the error.
	if !strings.Contains(err.Error(), "ORA-06512") {
		t.Errorf("error lost the upstream detail: %v", err)
	}
}

// The control number comes back unquoted from at least one code path on the
// city's side.
func TestSubmitAcceptsANumericControlNumber(t *testing.T) {
	city := newFakeCity(t, `{"controlno":20260001}`)

	got, err := city.client().Submit(context.Background(), goodReport(), "tk-1")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got.Reference != "20260001" {
		t.Errorf("reference %q, want 20260001", got.Reference)
	}
}

func TestSendOTP(t *testing.T) {
	city := newFakeCity(t, `{"request":"success","timer":300}`)

	if err := city.client().SendOTP(context.Background(), "someone@example.org"); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	c := city.calls[0]
	if c.Path != "verify/" {
		t.Errorf("path %q", c.Path)
	}
	if c.Query["trans"] != "sendOTP" || c.Query["email"] != "someone@example.org" {
		t.Errorf("query %+v", c.Query)
	}
}

func TestSendOTPFailsForAnUnverifiedEmail(t *testing.T) {
	city := newFakeCity(t, `{"request":"error","details":"Email is not yet validated"}`)

	err := city.client().SendOTP(context.Background(), "someone@example.org")
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	if !strings.Contains(err.Error(), "not yet validated") {
		t.Errorf("error lost the reason: %v", err)
	}
}

// The city answers an address it does not know with a 400 and a body naming
// the reason. That has to survive the status check, or the caller cannot tell
// it from the site being down.
func TestSendOTPTellsAnUnregisteredAddressApart(t *testing.T) {
	city := newFakeCity(t, `{"request":"error","message":"Failed to verify email","details":"Email not registered!"}`)
	city.status = http.StatusBadRequest

	err := city.client().SendOTP(context.Background(), "someone@example.org")
	if !errors.Is(err, ErrEmailNotRegistered) {
		t.Fatalf("want ErrEmailNotRegistered, got %v", err)
	}
}

// Anything else with a bad status is the city being unwell, and the log gets
// the whole reply.
func TestSendOTPKeepsTheCitysReplyForOtherFailures(t *testing.T) {
	city := newFakeCity(t, `<html><body>Server Error</body></html>`)
	city.status = http.StatusInternalServerError

	err := city.client().SendOTP(context.Background(), "someone@example.org")
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	if errors.Is(err, ErrEmailNotRegistered) {
		t.Fatalf("a server error read as an unknown address: %v", err)
	}
	if !strings.Contains(err.Error(), "Server Error") {
		t.Errorf("error lost the city's reply: %v", err)
	}
}

func TestVerifyOTPReturnsTheSession(t *testing.T) {
	city := newFakeCity(t, `{"data":{"token":"tk-9","tkdetails":{"tkexp":"2026-08-22T10:30:00Z"}}}`)

	got, err := city.client().VerifyOTP(context.Background(), "someone@example.org", "123456")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got.Token != "tk-9" {
		t.Errorf("token %q", got.Token)
	}
	if got.Expires.IsZero() {
		t.Error("want an expiry, got zero")
	}
	if city.calls[0].Query["otp"] != "123456" {
		t.Errorf("query %+v", city.calls[0].Query)
	}
}

func TestVerifyOTPRejectsABadCode(t *testing.T) {
	city := newFakeCity(t, `{"request":"error","details":"Invalid OTP"}`)

	if _, err := city.client().VerifyOTP(context.Background(), "someone@example.org", "000000"); err == nil {
		t.Fatal("want an error, got nil")
	}
}

// An unparseable expiry must not throw the session away; the reporter finds
// out when the city refuses the token.
func TestVerifyOTPKeepsTheTokenWhenTheExpiryIsUnreadable(t *testing.T) {
	city := newFakeCity(t, `{"data":{"token":"tk-9","tkdetails":{"tkexp":"whenever"}}}`)

	got, err := city.client().VerifyOTP(context.Background(), "someone@example.org", "123456")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got.Token != "tk-9" || !got.Expires.IsZero() {
		t.Errorf("session %+v", got)
	}
}

func TestTitleForPrefixesTheCategory(t *testing.T) {
	r := goodReport()
	if got := titleFor(r); got != "Pothole: Deep pothole in the outer lane near the corner." {
		t.Errorf("title %q", got)
	}
}

// The prefix is the word the reporter's chip carried, not a synonym of it.
// These two have drifted apart before; the chips are in
// frontend/src/types.ts.
func TestTitleForUsesTheWordTheReporterSaw(t *testing.T) {
	for category, want := range map[string]string{
		"streetlight": "Street light: ",
		"obstruction": "Blocked road: ",
	} {
		r := goodReport()
		r.Category = category
		if got := titleFor(r); !strings.HasPrefix(got, want) {
			t.Errorf("%s: title %q, want prefix %q", category, got, want)
		}
	}
}

// "other" has no label worth showing a clerk, so it gets no prefix.
func TestTitleForLeavesOtherUnprefixed(t *testing.T) {
	r := goodReport()
	r.Category = "other"
	if got := titleFor(r); got != "Deep pothole in the outer lane near the corner." {
		t.Errorf("title %q", got)
	}
}

func TestTitleForShortensALongDescription(t *testing.T) {
	r := goodReport()
	r.Description = strings.Repeat("word ", 200)
	got := titleFor(r)
	if len([]rune(got)) > maxTitleRunes+len("Pothole: ") {
		t.Errorf("title is %d runes: %q", len([]rune(got)), got)
	}
	if !strings.HasPrefix(got, "Pothole: ") {
		t.Errorf("title %q", got)
	}
}

// The city's form refuses an empty location, and a reporter in the field may
// only have coordinates.
func TestSubmitFallsBackToCoordinatesForTheLocation(t *testing.T) {
	city := newFakeCity(t, `{"controlno":"DCR-1"}`)
	r := goodReport()
	r.Address = ""

	if _, err := city.client().Submit(context.Background(), r, "tk-1"); err != nil {
		t.Fatal(err)
	}
	if got := city.calls[0].Fields["location"]; got != "7.0731,125.6128" {
		t.Errorf("location %q", got)
	}
}

// The list carries a reporter's own reports, in the city's own field names.
func TestMyReportsReadsTheCitysList(t *testing.T) {
	city := newFakeCity(t, `{"isValid":true,"data":[
		{"controlno":"DCR-2026-0001","title":"Pothole: outer lane","complain":"Deep pothole.",
		 "location":"Quimpo Blvd","current_status":"ongoing","date_reported":"2026-05-01T08:00:00Z",
		 "attachments":[{"link":"https://city.example/a.jpg","label":"a.jpg"},{"link":""}]}]}`)

	got, err := city.client().MyReports(context.Background(), "tk-1")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 report, got %d", len(got))
	}
	c := city.calls[0]
	if c.Path != "reportController" || c.Query["trans"] != "getuserdetails" || c.Query["xtk"] != "tk-1" {
		t.Errorf("request %+v", c)
	}
	want := Filed{
		Reference:   "DCR-2026-0001",
		Title:       "Pothole: outer lane",
		Description: "Deep pothole.",
		Location:    "Quimpo Blvd",
		// The city writes the status in either case; the reporter sees one.
		Status: "ONGOING",
		Filed:  "2026-05-01T08:00:00Z",
		Photos: []string{"https://city.example/a.jpg"},
	}
	if got[0].Reference != want.Reference || got[0].Status != want.Status || got[0].Filed != want.Filed {
		t.Errorf("got %+v, want %+v", got[0], want)
	}
	if len(got[0].Photos) != 1 || got[0].Photos[0] != want.Photos[0] {
		t.Errorf("photos %+v", got[0].Photos)
	}
}

// A dead session looks the same on the list as it does on a submission.
func TestMyReportsReportsAnExpiredSession(t *testing.T) {
	city := newFakeCity(t, `{"isValid":false}`)

	if _, err := city.client().MyReports(context.Background(), "tk-old"); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("want ErrSessionExpired, got %v", err)
	}
}

// The history carries the status steps, and the reason behind a status that
// needs one.
func TestHistoryReadsTheStepsAndTheReason(t *testing.T) {
	city := newFakeCity(t, `{"isValid":true,
		"data":[{"status":"FORRESUBMISSION","officename":"","startdate":"2026-05-03T08:00:00Z"},
		        {"status":"REPORTED","officename":"City Engineer","startdate":"2026-05-01T08:00:00Z"}],
		"result":[{"office":"City Engineer","attachments":[{"url":"https://city.example/f.pdf"}]}],
		"invalid":{"reason":"not used here"},
		"resubmit":{"reason":"the photo does not show the place"}}`)

	got, err := city.client().History(context.Background(), "DCR-2026-0001", "tk-1")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	c := city.calls[0]
	if c.Path != "complainController" || c.Query["trans"] != "getdetails" || c.Query["controlno"] != "DCR-2026-0001" {
		t.Errorf("request %+v", c)
	}
	if len(got.Steps) != 2 || got.Steps[1].Office != "City Engineer" {
		t.Fatalf("steps %+v", got.Steps)
	}
	if got.Note != "the photo does not show the place" {
		t.Errorf("note %q", got.Note)
	}
	if len(got.Resolutions) != 1 || len(got.Resolutions[0].Files) != 1 {
		t.Errorf("resolutions %+v", got.Resolutions)
	}
}

// The city answers an unknown control number with an empty list, and so does
// one that belongs to somebody else.
func TestHistoryReportsAnUnknownReference(t *testing.T) {
	city := newFakeCity(t, `{"isValid":true,"data":[]}`)

	if _, err := city.client().History(context.Background(), "nope", "tk-1"); !errors.Is(err, ErrNoSuchReport) {
		t.Fatalf("want ErrNoSuchReport, got %v", err)
	}
}

// The shape the live site answers with. The city sends `invalid`, `resubmit`,
// and `result` as empty arrays when there is nothing in them, and as objects
// or filled arrays when there is — a struct that expects only the object form
// fails to decode the whole reply, and the reporter is told the city could
// not say what happened. It also writes an apostrophe as an entity, and its
// timestamps are not RFC 3339.
func TestHistoryReadsTheShapeTheCityActuallySends(t *testing.T) {
	city := newFakeCity(t, `{"referenceno":"20260314170358392",
		"data":[
			{"startdate":"2026-03-14 16:55:59","enddate":"2026-03-14 17:31:38","status":"REPORTED","details":"","officename":""},
			{"startdate":"2026-03-18 13:21:27","enddate":null,"status":"RECEIVED","details":"Forwarded for feedback","officename":"CITY MAYOR&#039;S OFFICE"}],
		"result":[],"invalid":[],"resubmit":[],"forresubmission":false}`)

	got, err := city.client().History(context.Background(), "DCR-2026-0001", "tk-1")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if len(got.Steps) != 2 {
		t.Fatalf("steps %+v", got.Steps)
	}
	if got.Steps[1].Office != "CITY MAYOR'S OFFICE" {
		t.Errorf("office %q, want the apostrophe unescaped", got.Steps[1].Office)
	}
	// The layout is the city's own. Nothing here parses it; the browser does.
	if got.Steps[0].At != "2026-03-14 16:55:59" {
		t.Errorf("timestamp %q, want it passed through", got.Steps[0].At)
	}
	if got.CityReference != "20260314170358392" {
		t.Errorf("city reference %q", got.CityReference)
	}
	if got.Note != "" {
		t.Errorf("note %q, want none", got.Note)
	}
}

// The list is escaped the same way the history is.
func TestMyReportsUnescapesWhatTheCityStored(t *testing.T) {
	city := newFakeCity(t, `{"data":[{"controlno":"DCR-2026-0001","title":"Drainage: the mayor&#039;s street",
		"complain":"Blocked &amp; overflowing.","location":"Quimpo Blvd","current_status":"RECEIVED",
		"date_reported":"2026-03-14 16:55:59"}]}`)

	got, err := city.client().MyReports(context.Background(), "tk-1")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got[0].Title != "Drainage: the mayor's street" {
		t.Errorf("title %q", got[0].Title)
	}
	if got[0].Description != "Blocked & overflowing." {
		t.Errorf("description %q", got[0].Description)
	}
}
