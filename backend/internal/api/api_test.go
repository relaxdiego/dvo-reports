package api

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/relaxdiego/dvo-reports/backend/internal/photo"
	"github.com/relaxdiego/dvo-reports/backend/internal/report"
	"github.com/relaxdiego/dvo-reports/backend/internal/upstream"
)

type fakeUpstream struct {
	got      report.Report
	gotToken string
	gotEmail string
	err      error
	authErr  error
	receipt  upstream.Receipt

	filed        []upstream.Filed
	history      upstream.History
	listErr      error
	historyErr   error
	gotReference string
}

func (f *fakeUpstream) SendOTP(_ context.Context, email string) error {
	f.gotEmail = email
	return f.authErr
}

func (f *fakeUpstream) VerifyOTP(_ context.Context, email, _ string) (upstream.Session, error) {
	f.gotEmail = email
	if f.authErr != nil {
		return upstream.Session{}, f.authErr
	}
	return upstream.Session{Token: "tk-1"}, nil
}

func (f *fakeUpstream) Submit(_ context.Context, r report.Report, token string) (upstream.Receipt, error) {
	f.got = r
	f.gotToken = token
	if f.err != nil {
		if f.receipt.Reference != "" {
			return f.receipt, f.err
		}
		return upstream.Receipt{}, f.err
	}
	return upstream.Receipt{Reference: "REF-1"}, nil
}

func (f *fakeUpstream) MyReports(_ context.Context, token string) ([]upstream.Filed, error) {
	f.gotToken = token
	return f.filed, f.listErr
}

func (f *fakeUpstream) History(_ context.Context, reference, token string) (upstream.History, error) {
	f.gotToken = token
	f.gotReference = reference
	return f.history, f.historyErr
}

func newTestHandler(up upstream.Client) http.Handler {
	return New(Config{
		Upstream:       up,
		AllowedOrigins: []string{"https://reports.example.org"},
		Log:            slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

// form builds a multipart body. photos is filename -> content.
func form(t *testing.T, fields map[string]string, photos map[string][]byte) (string, io.Reader) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	for name, data := range photos {
		part, err := w.CreateFormFile("photos", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return w.FormDataContentType(), &buf
}

// geoPhoto is the smallest JPEG that says where it was taken: an Exif segment
// carrying a GPS directory with a latitude and a longitude, and no picture at
// all. Every photo a report may carry has to say this much, so every test
// that files a report sends one.
//
// It is written big-endian by hand, so what is tested is reading a file this
// project did not produce.
func geoPhoto() []byte {
	entry := func(tag, typ uint16, count, value uint32) []byte {
		b := make([]byte, 12)
		binary.BigEndian.PutUint16(b, tag)
		binary.BigEndian.PutUint16(b[2:], typ)
		binary.BigEndian.PutUint32(b[4:], count)
		binary.BigEndian.PutUint32(b[8:], value)
		return b
	}
	// Degrees, minutes, seconds, each a numerator over a denominator.
	dms := func(d, m, sec uint32) []byte {
		var b []byte
		for _, pair := range [][2]uint32{{d, 1}, {m, 1}, {sec, 1}} {
			n := make([]byte, 8)
			binary.BigEndian.PutUint32(n, pair[0])
			binary.BigEndian.PutUint32(n[4:], pair[1])
			b = append(b, n...)
		}
		return b
	}

	var tiff bytes.Buffer
	tiff.WriteString("MM")              // big-endian
	tiff.Write([]byte{0, 42})           // the TIFF marker
	tiff.Write([]byte{0, 0, 0, 8})      // IFD0 starts here
	tiff.Write([]byte{0, 1})            // one record in it
	tiff.Write(entry(0x8825, 4, 1, 26)) // the GPS directory
	tiff.Write([]byte{0, 0, 0, 0})      // no second image
	tiff.Write([]byte{0, 2})            // two GPS records
	tiff.Write(entry(0x0002, 5, 3, 56)) // latitude
	tiff.Write(entry(0x0004, 5, 3, 80)) // longitude
	tiff.Write([]byte{0, 0, 0, 0})      // end of the GPS directory
	tiff.Write(dms(7, 5, 51))           // 7°5'51" north
	tiff.Write(dms(125, 37, 20))        // 125°37'20" east

	body := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	out := []byte{0xFF, 0xD8, 0xFF, 0xE1}
	var n [2]byte
	binary.BigEndian.PutUint16(n[:], uint16(len(body)+2))
	out = append(out, n[:]...)
	out = append(out, body...)
	return append(out, 0xFF, 0xD9)
}

// blindPhoto is a JPEG that does not say where it was taken. A report may
// carry one.
var blindPhoto = []byte{0xFF, 0xD8, 0xFF, 0xD9}

// onePhoto is what every valid report now carries at least one of.
func onePhoto() map[string][]byte {
	return map[string][]byte{"photo.jpg": geoPhoto()}
}

func goodFields() map[string]string {
	return map[string]string{
		"category":    "obstruction",
		"description": "Deep pothole in the outer lane near the corner.",
		"lat":         "7.0731",
		"lon":         "125.6128",
	}
}

func TestSubmitRelaysTheReport(t *testing.T) {
	up := &fakeUpstream{}
	ct, body := form(t, goodFields(), onePhoto())

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body)
	}
	var got upstream.Receipt
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Reference != "REF-1" {
		t.Errorf("reference %q, want REF-1", got.Reference)
	}
	if up.got.Category != "obstruction" || up.got.Lat != 7.0731 {
		t.Errorf("upstream got %+v", up.got)
	}
	// The photo is filtered on the way through, so it is not the same bytes.
	// What has to survive is the place it was taken: that is what the report
	// is filed on.
	if len(up.got.Photos) != 1 || !photo.HasLocation(up.got.Photos[0].Data) {
		t.Errorf("photos did not arrive with their place: %+v", up.got.Photos)
	}
	if up.got.Photos[0].MediaType != "image/jpeg" {
		t.Errorf("media type %q, want image/jpeg", up.got.Photos[0].MediaType)
	}
}

func TestSubmitRejectsAnInvalidReport(t *testing.T) {
	fields := goodFields()
	fields["description"] = "short"
	ct, body := form(t, fields, nil)

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422; body %s", rec.Code, rec.Body)
	}
}

// A photograph that does not say where it was taken used to be refused here,
// and with it the reporter whose camera had its location switched off. The
// place is its own field now: the browser asks the reporter's phone when the
// photographs say nothing, and what has to be present is coordinates, not
// coordinates written inside a JPEG.
func TestSubmitTakesAPhotoThatDoesNotSayWhereItWasTaken(t *testing.T) {
	up := &fakeUpstream{}
	ct, body := form(t, goodFields(), map[string][]byte{"blind.jpg": blindPhoto})

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201; body %s", rec.Code, rec.Body)
	}
	if up.got.Lat != 7.0731 || up.got.Lon != 125.6128 {
		t.Errorf("filed at %g,%g, want the coordinates the form carried", up.got.Lat, up.got.Lon)
	}
}

// The other half of that: no coordinates from anywhere, and the report is
// refused however many photographs are attached.
func TestSubmitRefusesAReportWithNoPlace(t *testing.T) {
	up := &fakeUpstream{}
	fields := goodFields()
	delete(fields, "lat")
	delete(fields, "lon")
	ct, body := form(t, fields, onePhoto())

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422; body %s", rec.Code, rec.Body)
	}
	if up.got.Category != "" {
		t.Error("the report reached the city's site anyway")
	}
}

// The citizen must never see the city site's own error text.
func TestSubmitHidesUpstreamFailureDetail(t *testing.T) {
	up := &fakeUpstream{err: errors.New("<html>ORA-06512 at line 4</html>")}
	ct, body := form(t, goodFields(), onePhoto())

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d, want 502", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "ORA-06512") {
		t.Errorf("upstream detail leaked: %s", rec.Body)
	}
}

func TestSubmitRejectsTooManyPhotos(t *testing.T) {
	photos := map[string][]byte{}
	for i := 0; i <= report.MaxPhotos; i++ {
		photos[string(rune('a'+i))+".jpg"] = geoPhoto()
	}
	ct, body := form(t, goodFields(), photos)

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400; body %s", rec.Code, rec.Body)
	}
}

func TestPreflightAllowsTheConfiguredOrigin(t *testing.T) {
	req := httptest.NewRequest("OPTIONS", "/api/reports", nil)
	req.Header.Set("Origin", "https://reports.example.org")
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://reports.example.org" {
		t.Errorf("allow-origin %q", got)
	}
}

func TestPreflightIgnoresAnUnknownOrigin(t *testing.T) {
	req := httptest.NewRequest("OPTIONS", "/api/reports", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("allow-origin %q, want empty", got)
	}
}

func TestHealthz(t *testing.T) {
	req := httptest.NewRequest("GET", "/healthz", nil)
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
}

// Anyone can read the code this site runs on, and the page's footer names
// the frontend's build. This is the other half: the backend says which
// commit it was built from, so the running code can be checked against the
// published code rather than taken on trust.
func TestHealthzNamesTheBuild(t *testing.T) {
	h := New(Config{
		Upstream: &fakeUpstream{},
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		BuildSHA: "abc1234",
	})
	req := httptest.NewRequest("GET", "/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got, want := rec.Body.String(), "ok abc1234\n"; got != want {
		t.Errorf("body %q, want %q", got, want)
	}
}

// A build that was not told its commit must say so rather than claim a
// blank one. A laptop build is the ordinary case.
func TestHealthzSaysUnknownWhenTheBuildDidNotSay(t *testing.T) {
	req := httptest.NewRequest("GET", "/healthz", nil)
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if got, want := rec.Body.String(), "ok unknown\n"; got != want {
		t.Errorf("body %q, want %q", got, want)
	}
}

// A file that is not an image must be refused, whatever the client labels
// it. This backend relays uploads to a government site.
func TestSubmitRejectsANonImageDisguisedAsOne(t *testing.T) {
	ct, body := form(t, goodFields(), map[string][]byte{"invoice.jpg": []byte("%PDF-1.7\nnot an image at all")})

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422; body %s", rec.Code, rec.Body)
	}
}

func TestSubmitPassesTheSessionTokenOn(t *testing.T) {
	up := &fakeUpstream{}
	ct, body := form(t, goodFields(), onePhoto())

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-abc")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body)
	}
	if up.gotToken != "tk-abc" {
		t.Errorf("token %q", up.gotToken)
	}
}

func TestSubmitRefusesAReportWithNoSession(t *testing.T) {
	ct, body := form(t, goodFields(), onePhoto())

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401; body %s", rec.Code, rec.Body)
	}
}

func TestSubmitTellsTheReporterWhenTheSessionExpired(t *testing.T) {
	up := &fakeUpstream{err: upstream.ErrSessionExpired}
	ct, body := form(t, goodFields(), onePhoto())

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "stale")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401; body %s", rec.Code, rec.Body)
	}
}

// The report is filed. The citizen must be given the reference, not an
// error, even though the photos did not make it.
func TestSubmitReturnsTheReferenceWhenOnlyThePhotosFailed(t *testing.T) {
	up := &fakeUpstream{
		err:     upstream.ErrPhotosNotAttached,
		receipt: upstream.Receipt{Reference: "REF-7"},
	}
	ct, body := form(t, goodFields(), onePhoto())

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201; body %s", rec.Code, rec.Body)
	}
	var got struct {
		Reference string `json:"reference"`
		Warning   string `json:"warning"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Reference != "REF-7" {
		t.Errorf("reference %q, want the real one", got.Reference)
	}
	if got.Warning == "" {
		t.Error("want a warning about the photos")
	}
}

func TestSendOTPRelaysTheEmail(t *testing.T) {
	up := &fakeUpstream{}
	req := httptest.NewRequest("POST", "/api/auth/otp", strings.NewReader(`{"email":"someone@example.org"}`))
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204; body %s", rec.Code, rec.Body)
	}
	if up.gotEmail != "someone@example.org" {
		t.Errorf("email %q", up.gotEmail)
	}
}

func TestSendOTPRejectsAnEmptyEmail(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/auth/otp", strings.NewReader(`{"email":"  "}`))
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rec.Code)
	}
}

// An address with no city account is the reporter's to fix, not a bad
// gateway, and "try again later" would send them round a loop that cannot
// end.
func TestSendOTPTellsAnUnregisteredAddressWhatToDo(t *testing.T) {
	up := &fakeUpstream{authErr: upstream.ErrEmailNotRegistered}
	req := httptest.NewRequest("POST", "/api/auth/otp", strings.NewReader(`{"email":"someone@example.org"}`))
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404; body %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "register at reports.davaocity.gov.ph") {
		t.Errorf("the reporter is not told how to fix it: %s", rec.Body)
	}
	if strings.Contains(rec.Body.String(), "try again later") {
		t.Errorf("still telling them to retry: %s", rec.Body)
	}
}

func TestVerifyOTPReturnsTheSession(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/auth/session", strings.NewReader(`{"email":"someone@example.org","otp":"123456"}`))
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body)
	}
	var got upstream.Session
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Token != "tk-1" {
		t.Errorf("token %q", got.Token)
	}
}

func TestVerifyOTPRefusesABadCode(t *testing.T) {
	up := &fakeUpstream{authErr: errors.New("Invalid OTP")}
	req := httptest.NewRequest("POST", "/api/auth/session", strings.NewReader(`{"email":"someone@example.org","otp":"000000"}`))
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", rec.Code)
	}
	// The city's own wording must not reach the reporter verbatim.
	if strings.Contains(rec.Body.String(), "Invalid OTP") {
		t.Errorf("upstream detail leaked: %s", rec.Body)
	}
}

// Preflight has to allow the session header, or the browser never sends it.
func TestPreflightAllowsTheSessionHeader(t *testing.T) {
	req := httptest.NewRequest("OPTIONS", "/api/reports", nil)
	req.Header.Set("Origin", "https://reports.example.org")
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, sessionHeader) {
		t.Errorf("allow-headers %q, want it to include %s", got, sessionHeader)
	}
}

func TestMyReportsNeedsASession(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/reports", nil)
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", rec.Code)
	}
}

func TestMyReportsRelaysTheList(t *testing.T) {
	up := &fakeUpstream{filed: []upstream.Filed{{
		Reference: "2024-0001",
		Title:     "Pothole: outer lane",
		Status:    "ONGOING",
		Filed:     "2024-05-01T08:00:00Z",
	}}}

	req := httptest.NewRequest("GET", "/api/reports", nil)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body)
	}
	if up.gotToken != "tk-1" {
		t.Errorf("token %q, want tk-1", up.gotToken)
	}
	var out struct {
		Reports []upstream.Filed `json:"reports"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Reports) != 1 || out.Reports[0].Reference != "2024-0001" {
		t.Fatalf("reports %+v", out.Reports)
	}
}

func TestMyReportsAnswers401WhenTheSessionDied(t *testing.T) {
	up := &fakeUpstream{listErr: upstream.ErrSessionExpired}

	req := httptest.NewRequest("GET", "/api/reports", nil)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", rec.Code)
	}
}

func TestHistoryRelaysTheSteps(t *testing.T) {
	up := &fakeUpstream{history: upstream.History{
		Reference: "2024-0001",
		Steps:     []upstream.Step{{Status: "RECEIVED", Office: "City Engineer", At: "2024-05-02T08:00:00Z"}},
	}}

	req := httptest.NewRequest("GET", "/api/reports/2024-0001", nil)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body)
	}
	if up.gotReference != "2024-0001" {
		t.Errorf("reference %q, want 2024-0001", up.gotReference)
	}
	var got upstream.History
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Steps) != 1 || got.Steps[0].Status != "RECEIVED" {
		t.Fatalf("steps %+v", got.Steps)
	}
}

func TestHistoryAnswers404ForAnUnknownReference(t *testing.T) {
	up := &fakeUpstream{historyErr: upstream.ErrNoSuchReport}

	req := httptest.NewRequest("GET", "/api/reports/nope", nil)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
}

func TestHistoryHidesTheUpstreamErrorFromTheReporter(t *testing.T) {
	up := &fakeUpstream{historyErr: errors.New("<html>database error at line 42</html>")}

	req := httptest.NewRequest("GET", "/api/reports/2024-0001", nil)
	req.Header.Set(sessionHeader, "tk-1")
	rec := httptest.NewRecorder()
	newTestHandler(up).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d, want 502", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "database error") {
		t.Errorf("the city's error reached the reporter: %s", rec.Body)
	}
}
