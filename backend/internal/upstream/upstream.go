// Package upstream talks to reports.davaocity.gov.ph.
//
// This package is the only part of the backend that knows how the city site
// works. That is deliberate: the site has no documented API, so the real
// client has to imitate what its web form does, and that can change without
// warning. When it breaks, it breaks here and nowhere else.
package upstream

import (
	"context"
	"fmt"
	"strings"

	"github.com/relaxdiego/dvo-reports/backend/internal/report"
)

// Receipt is what the city gives back for an accepted report.
type Receipt struct {
	// Reference is the tracking number a citizen can quote later.
	Reference string `json:"reference"`
	// TrackURL is where the citizen can follow the report, if the city
	// gives one.
	TrackURL string `json:"track_url,omitempty"`
}

// Client is the city, as far as the rest of the backend is concerned.
//
// Filing a report needs a session, and the city only issues one against a
// one-time code sent to a registered reporter. The session token is passed
// in and handed back to the browser; nothing here holds on to it.
type Client interface {
	// SendOTP asks the city to send a one-time code to email.
	SendOTP(ctx context.Context, email string) error
	// VerifyOTP exchanges a code for a session.
	VerifyOTP(ctx context.Context, email, otp string) (Session, error)
	// Submit files one report using the session token.
	Submit(ctx context.Context, r report.Report, token string) (Receipt, error)
}

// Echo is a stand-in client for local development and tests. It accepts
// every valid report and invents a reference number, so the frontend can be
// built and demonstrated before the real client exists.
type Echo struct {
	// Seq numbers the receipts. Not safe for concurrent use; Echo is for
	// one developer on one laptop.
	Seq int
}

// SendOTP pretends the city sent a code. The code Echo accepts is any
// six digits; see VerifyOTP.
func (e *Echo) SendOTP(_ context.Context, _ string) error { return nil }

// VerifyOTP invents a session that never expires.
func (e *Echo) VerifyOTP(_ context.Context, _, _ string) (Session, error) {
	return Session{Token: "echo-token"}, nil
}

// Submit records nothing and returns a fake receipt.
func (e *Echo) Submit(_ context.Context, r report.Report, _ string) (Receipt, error) {
	e.Seq++
	return Receipt{
		Reference: fmt.Sprintf("ECHO-%s-%04d", strings.ToUpper(r.Category), e.Seq),
	}, nil
}
