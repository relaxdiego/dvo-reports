package report

import (
	"strings"
	"testing"
)

func valid() Report {
	return Report{
		Category:    "pothole",
		Description: "Deep pothole in the outer lane near the corner.",
		Address:     "Quimpo Blvd, Davao City",
		Lat:         7.0731,
		Lon:         125.6128,
		Photos:      []Photo{{Filename: "a.jpg", MediaType: "image/jpeg", Data: []byte("x")}},
	}
}

func TestValidateAcceptsAGoodReport(t *testing.T) {
	if err := valid().Validate(); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}

func TestValidateRejects(t *testing.T) {
	cases := map[string]func(*Report){
		"unknown category":   func(r *Report) { r.Category = "aliens" },
		"short description":  func(r *Report) { r.Description = "hole" },
		"long description":   func(r *Report) { r.Description = strings.Repeat("x", 2001) },
		"no coordinates":     func(r *Report) { r.Lat, r.Lon = 0, 0 },
		"latitude off earth": func(r *Report) { r.Lat, r.Lon = 91, 125 },
		"no photos at all":   func(r *Report) { r.Photos = nil },
		"too many photos":    func(r *Report) { r.Photos = make([]Photo, MaxPhotos+1) },
		"photo not an image": func(r *Report) { r.Photos = []Photo{{Filename: "a.pdf", MediaType: "application/pdf"}} },
		"photo over the size": func(r *Report) {
			r.Photos = []Photo{{Filename: "a.jpg", MediaType: "image/jpeg", Data: make([]byte, MaxPhotoBytes+1)}}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := valid()
			mutate(&r)
			if err := r.Validate(); err == nil {
				t.Fatal("want an error, got nil")
			}
		})
	}
}

// Coordinates alone are enough. A citizen in the field may not know the
// street name, and this project's own front end no longer asks for one: the
// place is set by moving a map.
func TestValidateAcceptsCoordinatesWithoutAddress(t *testing.T) {
	r := valid()
	r.Address = ""
	if err := r.Validate(); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}
