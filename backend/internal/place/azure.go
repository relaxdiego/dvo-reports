package place

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// AzureBaseURL is Microsoft's Azure Maps.
const AzureBaseURL = "https://atlas.microsoft.com"

// azureAPIVersion is the one the city's own form asks for, so that this
// client and theirs are answered by the same thing.
const azureAPIVersion = "2023-06-01"

// Azure asks Azure Maps, with this project's own subscription key. The zero
// value is not usable; use NewAzure.
type Azure struct {
	http    *http.Client
	baseURL string
	key     string
}

// NewAzure returns a geocoder using key. baseURL is for tests; empty means
// the real Azure Maps.
func NewAzure(key, baseURL string) *Azure {
	if baseURL == "" {
		baseURL = AzureBaseURL
	}
	return &Azure{
		http:    &http.Client{Timeout: 8 * time.Second},
		baseURL: strings.TrimRight(baseURL, "/"),
		key:     key,
	}
}

// Reverse names the place at lat,lon.
//
// Azure counts a position as longitude first, which is the opposite of the
// order every other part of this project writes one in. The city's own form
// has the same trap in it, and gets it right the same way.
func (a *Azure) Reverse(ctx context.Context, lat, lon float64) (Place, error) {
	q := url.Values{
		"api-version": {azureAPIVersion},
		"coordinates": {strconv.FormatFloat(lon, 'f', -1, 64) + "," + strconv.FormatFloat(lat, 'f', -1, 64)},
	}
	req, err := http.NewRequestWithContext(ctx, "GET", a.baseURL+"/reverseGeocode?"+q.Encode(), nil)
	if err != nil {
		return Place{}, err
	}
	// In the header, not the query string, so the key stays out of any log
	// or proxy that records URLs. The city's form puts it in the URL.
	req.Header.Set("subscription-key", a.key)
	req.Header.Set("Accept", "application/json")

	res, err := a.http.Do(req)
	if err != nil {
		return Place{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		// Deliberately not the body: an Azure error can quote the request,
		// and the request is a citizen's location.
		return Place{}, fmt.Errorf("azure maps answered %d", res.StatusCode)
	}

	var body struct {
		Features []struct {
			Properties struct {
				Address struct {
					FormattedAddress string `json:"formattedAddress"`
					Locality         string `json:"locality"`
					PostalCode       string `json:"postalCode"`
				} `json:"address"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return Place{}, err
	}
	if len(body.Features) == 0 {
		return Place{}, nil
	}

	got := body.Features[0].Properties.Address
	return Place{
		Address: got.FormattedAddress,
		// The city's own test, which is written three ways round and comes
		// to this: the locality is Davao, or the postcode is 8000.
		InDavao: got.Locality == "Davao" || got.PostalCode == "8000",
	}, nil
}
