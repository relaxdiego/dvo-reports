// Package place turns a pair of coordinates into a street a person can read.
//
// The city's own form does this with Azure Maps and puts the answer in its
// location box (js/map.js). This package asks the same question of the same
// service, with this project's own key, and sends the answer upstream in the
// same field — so a report filed here reads like one filed there.
//
// This is no longer the first thing asked. The page asks OpenStreetMap
// itself, from the reporter's own browser, because it names Davao's lanes
// and barangays where Azure names the nearest postal address it happens to
// hold — see frontend/src/street.ts. What is left here is what a browser
// cannot do:
//
//   - Azure, when AZURE_MAPS_KEY is set. Its key must never be shipped to a
//     page, so the page asks this backend when OpenStreetMap could not name
//     a road. The wording is the city's own, and so is the test for whether
//     a pin is in Davao.
//   - Nominatim, otherwise. OpenStreetMap's, free and needing no account,
//     which is what a developer with no key gets. It duplicates what the
//     page already asked and is kept so that the form works the same with
//     and without a key.
//
// The city's own key is not used here and must never be: it bills their
// account, and this repository is public.
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
	// Street reports whether Address names a street rather than only the
	// city around it. It is not sent to the browser, which shows whatever
	// line there is: it exists so Fallback can tell a useful answer from
	// one like "Davao, Philippines 8000", which every report could carry.
	Street bool `json:"-"`
}

// Fallback names a place with First, and asks Then when First could not name
// a street.
//
// Azure knows house numbers where it knows anything, and its wording is the
// city's own, so it is asked first. But its Philippine coverage stops at the
// named roads: a pin on an unnamed lane comes back as the city and postcode
// alone, which tells a clerk nothing that every other report does not also
// say. OpenStreetMap knows those lanes and the barangays around them, so it
// is worth a second question in exactly that case.
//
// First's answer is kept whenever Then has nothing better, so a lookup that
// used to produce a coarse line still produces it rather than nothing.
type Fallback struct {
	First, Then Geocoder
}

// Reverse names the place at lat,lon.
func (f Fallback) Reverse(ctx context.Context, lat, lon float64) (Place, error) {
	first, err := f.First.Reverse(ctx, lat, lon)
	if err == nil && first.Street {
		return first, nil
	}
	then, thenErr := f.Then.Reverse(ctx, lat, lon)
	if thenErr != nil || then.Address == "" {
		return first, err
	}
	return then, nil
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
			Quarter       string `json:"quarter"`
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
	// country and a postcode, which only make the line harder to read. In
	// Davao, Nominatim puts the barangay in quarter, not suburb, so quarter
	// wins when it has one.
	line := join(firstOf(a.Road, a.Neighbourhood), firstOf(a.Quarter, a.Suburb, a.Village), firstOf(a.City, a.Town))
	if line == "" {
		line = body.DisplayName
	}

	return Place{
		Address: line,
		InDavao: looksLikeDavao(a.City, a.Town, a.County, a.Postcode),
		Street:  a.Road != "",
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
