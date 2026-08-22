package place

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeNominatim stands in for the real one. reply is the body it sends back.
func fakeNominatim(t *testing.T, reply string, status int) (*httptest.Server, *[]*http.Request) {
	t.Helper()
	var got []*http.Request
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Clone(r.Context()))
		w.WriteHeader(status)
		_, _ = w.Write([]byte(reply))
	}))
	t.Cleanup(s.Close)
	return s, &got
}

const davaoReply = `{
  "display_name": "Quimpo Boulevard, Talomo, Davao City, Davao del Sur, Davao Region, 8000, Philippines",
  "address": {
    "road": "Quimpo Boulevard",
    "suburb": "Talomo",
    "city": "Davao City",
    "county": "Davao del Sur",
    "postcode": "8000"
  }
}`

func TestReverseNamesTheStreet(t *testing.T) {
	srv, _ := fakeNominatim(t, davaoReply, 200)

	got, err := NewNominatim(srv.URL).Reverse(context.Background(), 7.0731, 125.6128)
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	// The street, the barangay, the city. Not the region, the postcode, or
	// the country, which only make the line longer.
	if want := "Quimpo Boulevard, Talomo, Davao City"; got.Address != want {
		t.Errorf("address %q, want %q", got.Address, want)
	}
	if !got.InDavao {
		t.Error("Davao City was not recognised as Davao")
	}
}

// The policy asks for a User-Agent that says who is calling, and says a
// stock library default is not enough.
func TestReverseSaysWhoIsCalling(t *testing.T) {
	srv, got := fakeNominatim(t, davaoReply, 200)

	if _, err := NewNominatim(srv.URL).Reverse(context.Background(), 7.0731, 125.6128); err != nil {
		t.Fatal(err)
	}
	ua := (*got)[0].Header.Get("User-Agent")
	if !strings.Contains(ua, "dvo-reports") || !strings.Contains(ua, "github.com") {
		t.Errorf("User-Agent %q names neither the project nor where to find it", ua)
	}
}

// One request a second is the policy's absolute maximum.
func TestReverseWaitsBetweenRequests(t *testing.T) {
	srv, _ := fakeNominatim(t, davaoReply, 200)
	c := NewNominatim(srv.URL)

	start := time.Now()
	for i := 0; i < 2; i++ {
		if _, err := c.Reverse(context.Background(), 7.0731, 125.6128); err != nil {
			t.Fatal(err)
		}
	}
	if took := time.Since(start); took < minInterval {
		t.Errorf("two lookups took %v, which is faster than one a second", took)
	}
}

// A pin outside the city is not refused here. The city's own form refuses
// it; this only reports what it looks like, and the reporter decides.
func TestReverseSpotsSomewhereElse(t *testing.T) {
	srv, _ := fakeNominatim(t, `{
	  "display_name": "Session Road, Baguio, Benguet, Philippines",
	  "address": {"road": "Session Road", "city": "Baguio", "postcode": "2600"}
	}`, 200)

	got, err := NewNominatim(srv.URL).Reverse(context.Background(), 16.4116, 120.5933)
	if err != nil {
		t.Fatal(err)
	}
	if got.InDavao {
		t.Error("Baguio was taken for Davao")
	}
	if got.Address == "" {
		t.Error("the place still has a name, and the reporter should see it")
	}
}

// The postcode alone is enough, the way the city's own check has it.
func TestReverseAcceptsThePostcodeAlone(t *testing.T) {
	srv, _ := fakeNominatim(t, `{"address": {"road": "Somewhere", "postcode": "8000"}}`, 200)

	got, err := NewNominatim(srv.URL).Reverse(context.Background(), 7.07, 125.61)
	if err != nil {
		t.Fatal(err)
	}
	if !got.InDavao {
		t.Error("postcode 8000 was not taken for Davao")
	}
}

// Middle of the sea: there is no street, so the long name is all there is.
func TestReverseFallsBackToTheLongName(t *testing.T) {
	srv, _ := fakeNominatim(t, `{"display_name": "Davao Gulf, Philippines", "address": {}}`, 200)

	got, err := NewNominatim(srv.URL).Reverse(context.Background(), 7.0, 125.7)
	if err != nil {
		t.Fatal(err)
	}
	if got.Address != "Davao Gulf, Philippines" {
		t.Errorf("address %q", got.Address)
	}
}

func TestReverseReportsAServerThatRefuses(t *testing.T) {
	srv, _ := fakeNominatim(t, "slow down", http.StatusTooManyRequests)

	if _, err := NewNominatim(srv.URL).Reverse(context.Background(), 7.07, 125.61); err == nil {
		t.Fatal("want an error, got nil")
	}
}
