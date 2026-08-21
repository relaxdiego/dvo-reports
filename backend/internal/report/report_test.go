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
		"no location at all": func(r *Report) { r.Address = "" },
		"latitude off earth": func(r *Report) { r.Lat, r.Lon = 91, 125 },
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

// Coordinates alone are enough; a citizen in the field may not know the
// street name.
func TestValidateAcceptsCoordinatesWithoutAddress(t *testing.T) {
	r := valid()
	r.Address = ""
	r.Lat, r.Lon = 7.0731, 125.6128
	if err := r.Validate(); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}
