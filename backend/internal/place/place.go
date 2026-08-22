// Package place turns a pair of coordinates into a street a person can read.
//
// The city's own form does this with Azure Maps and puts the answer in its
// location box (js/map.js). This package asks the same question of the same
// service, with this project's own key, and sends the answer upstream in the
// same field — so a report filed here reads like one filed there.
//
// Two geocoders, chosen by whether a key is configured:
//
//   - Azure, when AZURE_MAPS_KEY is set. What the city itself uses, so the
//     wording matches theirs and so does the test for whether a pin is in
//     Davao.
//   - Nominatim, otherwise. OpenStreetMap's, free and needing no account,
//     which is what a developer gets without signing up for anything.
//
// The city's own key is readable in their public JavaScript. It is not used
// here and must never be: it bills their account, and this repository is
// public.
//
// Whichever is used, the lookup lives in the backend rather than the page.
// Nominatim's terms want a User-Agent naming the caller, which a browser
// cannot set, and Azure's key must not be shipped to one. A citizen's
// location never reaches a third party from their own device as a result.
//
// Nothing is stored. A lookup that fails is not an error a citizen should
// ever see: the report is filed with its coordinates instead, exactly as it
// was before this package existed.
package place

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Geocoder names the place at a pair of coordinates.
type Geocoder interface {
	Reverse(ctx context.Context, lat, lon float64) (Place, error)
}

// DefaultBaseURL is OpenStreetMap's public Nominatim.
const DefaultBaseURL = "https://nominatim.openstreetmap.org"

// userAgent identifies this project, as the policy requires. A stock library
// default is explicitly not enough.
const userAgent = "dvo-reports/1.0 (+https://github.com/relaxdiego/dvo-reports)"

// minInterval is the policy's hard limit, with a little room to spare.
const minInterval = 1100 * time.Millisecond

// Place is what one pair of coordinates turns out to be.
type Place struct {
	// Address is the street, as near as OpenStreetMap knows it. Empty when
	// there is nothing there to name.
	Address string `json:"address"`
	// InDavao reports whether this looks like somewhere the city will
	// accept. Their own form refuses anything else outright.
	InDavao bool `json:"in_davao"`
}

// Nominatim asks OpenStreetMap. The zero value is not usable; use
// NewNominatim.
type Nominatim struct {
	http    *http.Client
	baseURL string

	// One request at a time, and never faster than the policy allows. This
	// is a single small server, so a mutex is the whole rate limiter.
	mu   sync.Mutex
	last time.Time
}

func NewNominatim(baseURL string) *Nominatim {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Nominatim{
		http:    &http.Client{Timeout: 8 * time.Second},
		baseURL: strings.TrimRight(baseURL, "/"),
	}
}

// Reverse names the place at lat,lon.
func (c *Nominatim) Reverse(ctx context.Context, lat, lon float64) (Place, error) {
	if err := c.wait(ctx); err != nil {
		return Place{}, err
	}

	q := url.Values{
		"format":         {"jsonv2"},
		"lat":            {strconv.FormatFloat(lat, 'f', -1, 64)},
		"lon":            {strconv.FormatFloat(lon, 'f', -1, 64)},
		"zoom":           {"18"}, // Street level. Any closer names a building.
		"addressdetails": {"1"},
	}
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/reverse?"+q.Encode(), nil)
	if err != nil {
		return Place{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return Place{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Place{}, fmt.Errorf("nominatim answered %d", res.StatusCode)
	}

	var body struct {
		DisplayName string `json:"display_name"`
		Address     struct {
			Road          string `json:"road"`
			Neighbourhood string `json:"neighbourhood"`
			Suburb        string `json:"suburb"`
			Village       string `json:"village"`
			Town          string `json:"town"`
			City          string `json:"city"`
			County        string `json:"county"`
			Postcode      string `json:"postcode"`
		} `json:"address"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return Place{}, err
	}

	a := body.Address
	// What a city worker needs to find the spot: the street, the barangay,
	// and the city. Nominatim's own display_name adds the region, the
	// country and a postcode, which only make the line harder to read.
	line := join(firstOf(a.Road, a.Neighbourhood), firstOf(a.Suburb, a.Village), firstOf(a.City, a.Town))
	if line == "" {
		line = body.DisplayName
	}

	return Place{
		Address: line,
		InDavao: looksLikeDavao(a.City, a.Town, a.County, a.Postcode),
	}, nil
}

// wait holds the caller until a request is allowed. It is the whole of the
// rate limiting, and it is deliberately crude: one request at a time.
func (c *Nominatim) wait(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if since := time.Since(c.last); since < minInterval {
		select {
		case <-time.After(minInterval - since):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	c.last = time.Now()
	return nil
}

// looksLikeDavao mirrors the test the city's own form makes before it will
// accept a pin: the locality is Davao, or the postcode is 8000. Theirs is
// loose, and this one is no stricter — it only warns.
func looksLikeDavao(city, town, county, postcode string) bool {
	if postcode == "8000" {
		return true
	}
	for _, s := range []string{city, town, county} {
		if strings.Contains(strings.ToLower(s), "davao") {
			return true
		}
	}
	return false
}

func firstOf(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func join(vals ...string) string {
	var out []string
	for _, v := range vals {
		if v != "" {
			out = append(out, v)
		}
	}
	return strings.Join(out, ", ")
}
