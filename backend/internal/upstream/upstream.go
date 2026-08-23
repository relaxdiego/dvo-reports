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
	"sync/atomic"

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

// Filed is one report the reporter has already sent, as the city lists it.
type Filed struct {
	// Reference is the city's control number for the report.
	Reference string `json:"reference"`
	// Title is the one-line subject the city holds, which Submit built from
	// the category and the description.
	Title string `json:"title"`
	// Description is the report body as the city stored it.
	Description string `json:"description"`
	// Location is the place text the report was filed with.
	Location string `json:"location"`
	// Status is the city's current status word, e.g. "RECEIVED". The set is
	// listed in docs/upstream.md.
	Status string `json:"status"`
	// Filed is the city's own timestamp, passed through exactly as it was
	// sent. Its layout is not documented, so nothing here parses it; the
	// browser reads it the same way the city's own page does.
	Filed string `json:"filed"`
	// Photos are links to the images on the city's site, if it returned any.
	Photos []string `json:"photos,omitempty"`
}

// Step is one entry in what became of a report.
type Step struct {
	// Status is the city's status word at this point.
	Status string `json:"status"`
	// Office is the office the step belongs to, when the city names one.
	Office string `json:"office,omitempty"`
	// At is the city's timestamp for the step, passed through unparsed.
	At string `json:"at"`
}

// Resolution is one office's answer to a report.
type Resolution struct {
	// Office is the office that answered.
	Office string `json:"office"`
	// Files are links to whatever the office attached, on the city's site.
	Files []string `json:"files,omitempty"`
}

// History is what has happened to one filed report.
type History struct {
	// Reference is the control number the history belongs to. The city calls
	// it the transaction number.
	Reference string `json:"reference"`
	// Steps are the status changes, newest first.
	Steps []Step `json:"steps"`
	// Note is the city's reason for a status that needs one — a report it
	// marked INVALID, or one it wants filed again. Empty otherwise.
	Note string `json:"note,omitempty"`
	// Resolutions are the answers from the offices that handled the report.
	Resolutions []Resolution `json:"resolutions,omitempty"`
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
	// MyReports lists the reports the session's owner has already filed.
	MyReports(ctx context.Context, token string) ([]Filed, error)
	// History tells what became of one filed report.
	History(ctx context.Context, reference, token string) (History, error)
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

// MyReports returns made-up reports, so the past reports view can be built
// without a city account. Echo keeps nothing, so these are the same two every
// time and they say what they are.
func (e *Echo) MyReports(_ context.Context, _ string) ([]Filed, error) {
	return []Filed{
		{
			Reference:   "ECHO-0002",
			Title:       "Pothole: made-up report, never sent to the city",
			Description: "The echo upstream invented this. Nothing was filed.",
			Location:    "Nowhere",
			Status:      "ONGOING",
			Filed:       "2020-01-02T08:00:00Z",
		},
		{
			Reference:   "ECHO-0001",
			Title:       "Garbage: made-up report, never sent to the city",
			Description: "The echo upstream invented this. Nothing was filed.",
			Location:    "Nowhere",
			Status:      "RESOLVED",
			Filed:       "2020-01-01T08:00:00Z",
		},
	}, nil
}

// History invents a history for an Echo reference.
func (e *Echo) History(_ context.Context, reference, _ string) (History, error) {
	return History{
		Reference: reference,
		Steps: []Step{
			{Status: "RECEIVED", Office: "Nobody's office", At: "2020-01-03T08:00:00Z"},
			{Status: "REPORTED", At: "2020-01-01T08:00:00Z"},
		},
	}, nil
}

// Submit records nothing and returns a fake receipt.
func (e *Echo) Submit(_ context.Context, r report.Report, _ string) (Receipt, error) {
	e.Seq++
	return Receipt{
		Reference: fmt.Sprintf("ECHO-%s-%04d", strings.ToUpper(r.Category), e.Seq),
	}, nil
}

// NoSubmit is the real city client with filing turned off. It is for a
// deployed test environment.
//
// Everything a reporter reads still comes from the city: the one-time code,
// their own past reports, what became of one. That is deliberate. This
// package imitates a web form that can change without warning, and a
// stand-in that answers every call — Echo — would leave City untested
// wherever it ran, which is the opposite of what a staging environment is
// for. Submit is the one call that writes to the city's database, and a test
// report there is work for the people who staff their queue.
//
// The reference says what it is, in plain words, because the reporter is
// shown it. A number that could pass for the city's would be a lie.
type NoSubmit struct {
	// Client is the real city client. Every call but Submit is its own.
	Client
	// seq numbers the receipts. Atomic: unlike Echo, this one is deployed
	// and answers more than one request at a time.
	seq atomic.Int64
}

// Submit files nothing, and says so in the reference.
func (n *NoSubmit) Submit(_ context.Context, _ report.Report, _ string) (Receipt, error) {
	return Receipt{Reference: fmt.Sprintf("NOT-FILED-%04d", n.seq.Add(1))}, nil
}
