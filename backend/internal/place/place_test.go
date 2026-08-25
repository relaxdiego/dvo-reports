package place

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// errStub is a geocoder being down. Which geocoder, and why, is not what any
// of these tests is about.
var errStub = errors.New("geocoder is down")

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
	// the country, which only make the line longer. This reply carries no
	// quarter, so "Talomo" has to come from suburb, the older fallback.
	if want := "Quimpo Boulevard, Talomo, Davao City"; got.Address != want {
		t.Errorf("address %q, want %q", got.Address, want)
	}
	if !got.InDavao {
		t.Error("Davao City was not recognised as Davao")
	}
}

// What OpenStreetMap sends for the Shell station on J. P. Laurel Avenue: the
// barangay is in quarter, not suburb — suburb there is the district above it.
const davaoQuarterReply = `{
  "display_name": "Shell, J. P. Laurel Avenue, Kalayaan, Wilfredo C. Aquino, Agdao District, Buhangin District, Davao City, Davao Region, 8000, Philippines",
  "address": {
    "amenity": "Shell",
    "road": "J. P. Laurel Avenue",
    "neighbourhood": "Kalayaan",
    "quarter": "Wilfredo C. Aquino",
    "suburb": "Agdao District",
    "city_district": "Buhangin District",
    "city": "Davao City",
    "region": "Davao Region",
    "postcode": "8000",
    "country": "Philippines"
  }
}`

// The barangay, not the district above it, is what a clerk routes a report
// by, and Nominatim names it in quarter rather than suburb.
func TestReverseNamesTheBarangayFromQuarter(t *testing.T) {
	srv, _ := fakeNominatim(t, davaoQuarterReply, 200)

	got, err := NewNominatim(srv.URL).Reverse(context.Background(), 7.09790, 125.62179)
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if want := "J. P. Laurel Avenue, Wilfredo C. Aquino, Davao City"; got.Address != want {
		t.Errorf("address %q, want %q", got.Address, want)
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

// What OpenStreetMap sends for the pin in the report that prompted Fallback:
// no road, because the lane it sits on has no name, but the barangay around
// it is named and that is what a clerk needs.
const davaoNoRoadReply = `{
  "display_name": "San Vicente, Tambacan, Daliao, Toril District, Davao City, Davao Region, 8025, Philippines",
  "address": {
    "neighbourhood": "San Vicente",
    "suburb": "Daliao",
    "city": "Davao City",
    "postcode": "8025"
  }
}`

func TestReverseSaysWhenItNamedNoStreet(t *testing.T) {
	srv, _ := fakeNominatim(t, davaoNoRoadReply, 200)

	got, err := NewNominatim(srv.URL).Reverse(context.Background(), 7.00706, 125.50403)
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got.Street {
		t.Error("an answer with no road was counted as naming a street")
	}
	// Still worth sending: it names the barangay, which no coarse answer does.
	if want := "San Vicente, Daliao, Davao City"; got.Address != want {
		t.Errorf("address %q, want %q", got.Address, want)
	}
	if !got.InDavao {
		t.Error("Davao City was not recognised as Davao")
	}
}

// stubGeocoder answers with whatever it was built with, and counts the asking.
type stubGeocoder struct {
	place Place
	err   error
	asked int
}

func (s *stubGeocoder) Reverse(context.Context, float64, float64) (Place, error) {
	s.asked++
	return s.place, s.err
}

// The common case: Azure knows the street, so OpenStreetMap is never asked.
// That matters beyond speed — Nominatim allows one request a second, and a
// second question on every lookup would spend that allowance on nothing.
func TestFallbackDoesNotAskTwiceWhenTheFirstNamesAStreet(t *testing.T) {
	first := &stubGeocoder{place: Place{Address: "Quimpo Blvd, Davao City", InDavao: true, Street: true}}
	then := &stubGeocoder{place: Place{Address: "somewhere else"}}

	got, err := Fallback{First: first, Then: then}.Reverse(context.Background(), 7.0731, 125.6128)
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got.Address != "Quimpo Blvd, Davao City" {
		t.Errorf("address %q, want the first geocoder's", got.Address)
	}
	if then.asked != 0 {
		t.Errorf("the second geocoder was asked %d times, want 0", then.asked)
	}
}

// The case this exists for: Azure places the pin in Davao and no closer.
func TestFallbackPrefersANamedPlaceToACoarseOne(t *testing.T) {
	first := &stubGeocoder{place: Place{Address: "Davao, Philippines 8000", InDavao: true}}
	then := &stubGeocoder{place: Place{Address: "San Vicente, Daliao, Davao City", InDavao: true}}

	got, err := Fallback{First: first, Then: then}.Reverse(context.Background(), 7.00706, 125.50403)
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if want := "San Vicente, Daliao, Davao City"; got.Address != want {
		t.Errorf("address %q, want %q", got.Address, want)
	}
}

// A second geocoder that has nothing to say must not cost the report the
// line it already had, coarse as that line is.
func TestFallbackKeepsTheCoarseAnswerWhenTheSecondHasNothing(t *testing.T) {
	for _, tc := range []struct {
		name string
		then *stubGeocoder
	}{
		{"an error", &stubGeocoder{err: errStub}},
		{"an empty answer", &stubGeocoder{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			first := &stubGeocoder{place: Place{Address: "Davao, Philippines 8000", InDavao: true}}

			got, err := Fallback{First: first, Then: tc.then}.Reverse(context.Background(), 7.00706, 125.50403)
			if err != nil {
				t.Fatalf("want nil, got %v", err)
			}
			if want := "Davao, Philippines 8000"; got.Address != want {
				t.Errorf("address %q, want %q", got.Address, want)
			}
			if !got.InDavao {
				t.Error("the first geocoder's Davao answer was lost")
			}
		})
	}
}

// Azure being down is the other reason there is no street.
func TestFallbackAsksTheSecondWhenTheFirstFails(t *testing.T) {
	first := &stubGeocoder{err: errStub}
	then := &stubGeocoder{place: Place{Address: "San Vicente, Daliao, Davao City", InDavao: true}}

	got, err := Fallback{First: first, Then: then}.Reverse(context.Background(), 7.00706, 125.50403)
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if want := "San Vicente, Daliao, Davao City"; got.Address != want {
		t.Errorf("address %q, want %q", got.Address, want)
	}
}

// Both down. The caller is told, and answers the citizen with the
// coordinates, exactly as it did before either geocoder existed.
func TestFallbackReportsTheFirstFailureWhenBothFail(t *testing.T) {
	first := &stubGeocoder{err: errStub}

	got, err := Fallback{First: first, Then: &stubGeocoder{err: errStub}}.Reverse(context.Background(), 7.0, 125.5)
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	if got.Address != "" {
		t.Errorf("address %q, want empty", got.Address)
	}
}

// TestTransportErrorKeepsTheCoordinatesOutOfTheError covers both clients.
// api logs this error as "reverse geocode failed", and net/http quotes the
// address it called — which holds the pin the citizen's photograph put down.
func TestTransportErrorKeepsTheCoordinatesOutOfTheError(t *testing.T) {
	// A server that is not listening: Do fails before any reply, which is
	// the only path that carries a *url.Error.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close()

	// A pin whose digits are distinctive enough to spot in any wording.
	const lat, lon = 7.0731123, 125.6128456
	for _, tc := range []struct {
		name string
		rev  interface {
			Reverse(context.Context, float64, float64) (Place, error)
		}
	}{
		{"nominatim", NewNominatim(srv.URL)},
		{"azure", NewAzure("key-that-must-not-be-logged", srv.URL)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tc.rev.Reverse(context.Background(), lat, lon)
			if err == nil {
				t.Fatal("want an error from a closed server, got nil")
			}
			for _, secret := range []string{"7.0731123", "125.6128456", srv.URL, "key-that-must-not-be-logged"} {
				if strings.Contains(err.Error(), secret) {
					t.Errorf("%q reached the error: %v", secret, err)
				}
			}
		})
	}
}
