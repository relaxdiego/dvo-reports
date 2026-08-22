package upstream

import (
	"context"
	"strings"
	"testing"
)

// A staging environment must not put practice reports in the city's queue.
func TestNoSubmitFilesNothing(t *testing.T) {
	city := newFakeCity(t, `{"controlno":"20260001"}`)
	n := &NoSubmit{Client: city.client()}

	if _, err := n.Submit(context.Background(), goodReport(), "tk-1"); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got := len(city.calls); got != 0 {
		t.Errorf("the city was called %d times, want 0", got)
	}
}

// The reporter is shown this number. It has to say what it is.
func TestNoSubmitSaysTheReportWasNotFiled(t *testing.T) {
	n := &NoSubmit{}

	got, err := n.Submit(context.Background(), goodReport(), "tk-1")
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if !strings.Contains(got.Reference, "NOT-FILED") {
		t.Errorf("reference %q does not say the report was not filed", got.Reference)
	}
}

// Reads are the point: they exercise the code that parses the city's replies.
func TestNoSubmitPassesReadsToTheCity(t *testing.T) {
	city := newFakeCity(t, `{"isValid":true,"data":[{"controlno":"20260001"}]}`)
	n := &NoSubmit{Client: city.client()}

	if _, err := n.MyReports(context.Background(), "tk-1"); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got := len(city.calls); got != 1 {
		t.Errorf("the city was called %d times, want 1", got)
	}
}
