package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

// gifBytes is the smallest thing http.DetectContentType calls an image.
var gifBytes = []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;")

// onePhoto is what every valid report now carries at least one of.
func onePhoto() map[string][]byte {
	return map[string][]byte{"photo.gif": gifBytes}
}

func goodFields() map[string]string {
	return map[string]string{
		"category":    "pothole",
		"description": "Deep pothole in the outer lane near the corner.",
		"lat":         "7.0731",
		"lon":         "125.6128",
	}
}

func TestSubmitRelaysTheReport(t *testing.T) {
	up := &fakeUpstream{}
	ct, body := form(t, goodFields(), map[string][]byte{"photo.gif": gifBytes})

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
	if up.got.Category != "pothole" || up.got.Lat != 7.0731 {
		t.Errorf("upstream got %+v", up.got)
	}
	if len(up.got.Photos) != 1 || !bytes.Equal(up.got.Photos[0].Data, gifBytes) {
		t.Errorf("photos did not arrive intact: %+v", up.got.Photos)
	}
	if up.got.Photos[0].MediaType != "image/gif" {
		t.Errorf("media type %q, want image/gif", up.got.Photos[0].MediaType)
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
		photos[string(rune('a'+i))+".gif"] = gifBytes
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
	ct, body := form(t, goodFields(), map[string][]byte{"a.gif": gifBytes})

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
