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
	got report.Report
	err error
}

func (f *fakeUpstream) Submit(_ context.Context, r report.Report) (upstream.Receipt, error) {
	f.got = r
	if f.err != nil {
		return upstream.Receipt{}, f.err
	}
	return upstream.Receipt{Reference: "REF-1"}, nil
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
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422; body %s", rec.Code, rec.Body)
	}
}

// The citizen must never see the city site's own error text.
func TestSubmitHidesUpstreamFailureDetail(t *testing.T) {
	up := &fakeUpstream{err: errors.New("<html>ORA-06512 at line 4</html>")}
	ct, body := form(t, goodFields(), nil)

	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
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
	rec := httptest.NewRecorder()
	newTestHandler(&fakeUpstream{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422; body %s", rec.Code, rec.Body)
	}
}
