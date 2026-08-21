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

// Client submits a report to the city.
type Client interface {
	Submit(ctx context.Context, r report.Report) (Receipt, error)
}

// Echo is a stand-in client for local development and tests. It accepts
// every valid report and invents a reference number, so the frontend can be
// built and demonstrated before the real client exists.
type Echo struct {
	// Seq numbers the receipts. Not safe for concurrent use; Echo is for
	// one developer on one laptop.
	Seq int
}

// Submit records nothing and returns a fake receipt.
func (e *Echo) Submit(_ context.Context, r report.Report) (Receipt, error) {
	e.Seq++
	return Receipt{
		Reference: fmt.Sprintf("ECHO-%s-%04d", strings.ToUpper(r.Category), e.Seq),
	}, nil
}
