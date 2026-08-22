package api

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// alerted runs one submission against a handler that alerts to a test server,
// and returns what the server received.
func alerted(t *testing.T, up *fakeUpstream) string {
	t.Helper()
	got := make(chan string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got <- string(body)
	}))
	defer srv.Close()

	h := New(Config{
		Upstream:       up,
		AllowedOrigins: []string{"https://reports.example.org"},
		Log:            slog.New(slog.NewTextHandler(io.Discard, nil)),
		AlertURL:       srv.URL,
	})
	ct, body := form(t, goodFields(), onePhoto())
	req := httptest.NewRequest("POST", "/api/reports", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set(sessionHeader, "tk-1")
	h.ServeHTTP(httptest.NewRecorder(), req)

	select {
	case s := <-got:
		return s
	case <-time.After(5 * time.Second):
		t.Fatal("no alert arrived")
		return ""
	}
}

// Filing is exercised in production alone, so a failure there has to reach
// somebody without anybody reading the logs.
func TestSubmitAlertsWhenTheReportIsNotFiled(t *testing.T) {
	got := alerted(t, &fakeUpstream{err: errors.New("<html>ORA-06512 at line 4</html>")})

	if !strings.Contains(got, "not filed") {
		t.Errorf("alert does not say the report was not filed: %q", got)
	}
}

// The alert goes to a third party. A report is a real person's location and
// photographs, and none of it may travel with the news that filing broke —
// including by way of the city's reply, which quotes the title back.
func TestTheAlertCarriesNoPartOfTheReport(t *testing.T) {
	got := alerted(t, &fakeUpstream{err: errors.New("city rejected the report: Pothole: " + goodFields()["description"])})

	for _, secret := range []string{goodFields()["description"], goodFields()["lat"], goodFields()["lon"], "ORA-06512"} {
		if secret != "" && strings.Contains(got, secret) {
			t.Errorf("alert leaked %q: %q", secret, got)
		}
	}
}

// A missing URL is the normal case outside production. It must not be a POST
// to nowhere, and it must not stop the reporter getting an answer.
func TestNoAlertURLSendsNothing(t *testing.T) {
	alert(Config{Log: slog.New(slog.NewTextHandler(io.Discard, nil))}, "ignored")
}
