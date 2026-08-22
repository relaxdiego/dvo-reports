package place

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeAzure stands in for Azure Maps and records what it was asked.
func fakeAzure(t *testing.T, reply string, status int) (*httptest.Server, *[]*http.Request) {
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

// The shape the city's own form reads: features[0].properties.address.
const azureDavao = `{
  "features": [
    {"properties": {"address": {
      "formattedAddress": "Quimpo Blvd, Davao City, Davao del Sur 8000",
      "locality": "Davao",
      "postalCode": "8000"
    }}}
  ]
}`

func TestAzureNamesTheStreetTheWayTheCityDoes(t *testing.T) {
	srv, _ := fakeAzure(t, azureDavao, 200)

	got, err := NewAzure("k", srv.URL).Reverse(context.Background(), 7.0731, 125.6128)
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	// Azure's own formattedAddress, unedited: the city files this string,
	// so this client should not improve on it.
	if want := "Quimpo Blvd, Davao City, Davao del Sur 8000"; got.Address != want {
		t.Errorf("address %q, want %q", got.Address, want)
	}
	if !got.InDavao {
		t.Error("locality Davao was not recognised")
	}
}

// Azure reads a position as longitude first. Everything else in this project
// writes latitude first, so getting this backwards would put every report on
// the wrong continent and still look like it worked.
func TestAzureSendsLongitudeFirst(t *testing.T) {
	srv, got := fakeAzure(t, azureDavao, 200)

	if _, err := NewAzure("k", srv.URL).Reverse(context.Background(), 7.0731, 125.6128); err != nil {
		t.Fatal(err)
	}
	if c := (*got)[0].URL.Query().Get("coordinates"); c != "125.6128,7.0731" {
		t.Errorf("coordinates %q, want longitude first", c)
	}
}

// The key belongs in a header. In a query string it ends up in every access
// log and proxy between here and Azure — which is how the city's own key
// came to be readable in the first place.
func TestAzureKeepsTheKeyOutOfTheURL(t *testing.T) {
	srv, got := fakeAzure(t, azureDavao, 200)

	if _, err := NewAzure("super-secret", srv.URL).Reverse(context.Background(), 7.07, 125.61); err != nil {
		t.Fatal(err)
	}
	req := (*got)[0]
	if strings.Contains(req.URL.String(), "super-secret") {
		t.Errorf("the key is in the URL: %s", req.URL)
	}
	if req.Header.Get("subscription-key") != "super-secret" {
		t.Error("the key did not travel in the header either, so nothing would authenticate")
	}
}

// The city's check is written three ways round; the postcode alone passes it.
func TestAzureAcceptsThePostcodeAlone(t *testing.T) {
	srv, _ := fakeAzure(t, `{"features":[{"properties":{"address":{
	  "formattedAddress": "Somewhere", "locality": "Toril", "postalCode": "8000"}}}]}`, 200)

	got, err := NewAzure("k", srv.URL).Reverse(context.Background(), 7.07, 125.61)
	if err != nil {
		t.Fatal(err)
	}
	if !got.InDavao {
		t.Error("postcode 8000 was not taken for Davao")
	}
}

func TestAzureSpotsSomewhereElse(t *testing.T) {
	srv, _ := fakeAzure(t, `{"features":[{"properties":{"address":{
	  "formattedAddress": "Session Rd, Baguio", "locality": "Baguio", "postalCode": "2600"}}}]}`, 200)

	got, err := NewAzure("k", srv.URL).Reverse(context.Background(), 16.4116, 120.5933)
	if err != nil {
		t.Fatal(err)
	}
	if got.InDavao {
		t.Error("Baguio was taken for Davao")
	}
}

// Nothing there. Not an error: the report goes with its coordinates.
func TestAzureAnswersEmptyWhenNothingIsFound(t *testing.T) {
	srv, _ := fakeAzure(t, `{"features": []}`, 200)

	got, err := NewAzure("k", srv.URL).Reverse(context.Background(), 7.07, 125.61)
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	if got.Address != "" || got.InDavao {
		t.Errorf("got %+v, want an empty place", got)
	}
}

// A rejected key must not put Azure's reply — which can quote the request,
// and the request is a citizen's location — into this project's logs.
func TestAzureDoesNotQuoteTheBodyOnFailure(t *testing.T) {
	srv, _ := fakeAzure(t, `{"error":"bad key for coordinates 125.6128,7.0731"}`, http.StatusUnauthorized)

	_, err := NewAzure("k", srv.URL).Reverse(context.Background(), 7.0731, 125.6128)
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	if strings.Contains(err.Error(), "7.0731") {
		t.Errorf("the error carries the citizen's coordinates: %v", err)
	}
}
