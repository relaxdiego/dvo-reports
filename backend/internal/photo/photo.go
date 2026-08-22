// Package photo strips the metadata a citizen's photograph carries, keeping
// only a named few fields.
//
// A phone writes far more into a JPEG than the picture: the camera model, the
// software version, lens and exposure settings, a private block from the
// manufacturer, a second copy of the image as a thumbnail, and — the reason
// this package exists — where the photograph was taken. A report is relayed
// to a government site, so what travels with it is decided here rather than
// left to whatever the phone chose to write.
//
// The filter is a whitelist, and it works by rebuilding the metadata from
// nothing rather than deleting from what arrived. A tag survives only because
// this file names it. A phone that invents a new one next year does not get
// the benefit of the doubt.
package photo

import (
	"bytes"
	"encoding/binary"
)

// The tags kept, by the IFD they live in. Everything absent from these lists
// is dropped, including the make, the model, the software version, the lens,
// every exposure setting, and the embedded thumbnail.
var (
	// keepIFD0 is the main image directory.
	keepIFD0 = map[uint16]bool{
		0x0132: true, // DateTime
	}

	// keepExif is the Exif sub-directory. The offsets go with the timestamps:
	// "09:16:00" without "+08:00" is not a time, and the city reads reports
	// from more than one time zone's worth of visitors.
	keepExif = map[uint16]bool{
		0x9003: true, // DateTimeOriginal
		0x9004: true, // DateTimeDigitized
		0x9010: true, // OffsetTime
		0x9011: true, // OffsetTimeOriginal
		0x9012: true, // OffsetTimeDigitized
	}
)

// The whole GPS directory is kept. Position is the point of it, but the
// altitude, bearing, speed, and error radius all describe the same reading
// and are worth as much as the coordinates alone.

const (
	tagExifIFD = 0x8769
	tagGPSIFD  = 0x8825
)

// typeSize is the width of one value of each TIFF type. An unknown type has
// no width, so an entry using one is dropped rather than guessed at.
var typeSize = map[uint16]uint32{
	1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
}

// Clean returns img with its metadata reduced to the kept tags. A JPEG that
// carries nothing worth keeping comes back with no metadata at all.
//
// Anything that is not a JPEG is returned unchanged: this backend accepts
// what the browser sends, and the browser sends JPEG. A caller handing in
// another format gets no promise from this package.
func Clean(img []byte) []byte {
	if len(img) < 4 || img[0] != 0xFF || img[1] != 0xD8 {
		return img
	}
	var out bytes.Buffer
	out.Write(img[:2]) // SOI

	kept := false
	i := 2
	for i+4 <= len(img) {
		if img[i] != 0xFF {
			break // Not a marker where one belongs; copy the rest verbatim.
		}
		marker := img[i+1]
		if marker == 0xD8 || marker == 0xD9 || (marker >= 0xD0 && marker <= 0xD7) {
			out.Write(img[i : i+2])
			i += 2
			continue
		}
		if marker == 0xDA { // Start of scan: the image itself follows.
			break
		}
		length := int(binary.BigEndian.Uint16(img[i+2:]))
		if length < 2 || i+2+length > len(img) {
			break
		}
		seg := img[i+4 : i+2+length]

		switch {
		case marker == 0xE1 && bytes.HasPrefix(seg, []byte("Exif\x00\x00")):
			// The one segment worth reading. Rebuilt, or dropped entirely.
			if !kept {
				if rebuilt := filterExif(seg[6:]); rebuilt != nil {
					writeSegment(&out, 0xE1, append([]byte("Exif\x00\x00"), rebuilt...))
				}
				kept = true
			}
		case marker >= 0xE0 && marker <= 0xEF:
			// Every other application segment goes: XMP, ICC profiles, the
			// Photoshop and IPTC blocks, Apple's rotation data, and the
			// multi-picture index that points at a second embedded frame.
			// APP0 is kept because a JFIF header is structural, not personal.
			if marker == 0xE0 {
				out.Write(img[i : i+2+length])
			}
		case marker == 0xFE:
			// A comment is free text. It has been used to carry worse.
		default:
			out.Write(img[i : i+2+length])
		}
		i += 2 + length
	}
	out.Write(img[i:]) // The scan and everything after it.
	return out.Bytes()
}

func writeSegment(out *bytes.Buffer, marker byte, body []byte) {
	out.WriteByte(0xFF)
	out.WriteByte(marker)
	var n [2]byte
	binary.BigEndian.PutUint16(n[:], uint16(len(body)+2))
	out.Write(n[:])
	out.Write(body)
}

// entry is one directory record, with its value already read out of wherever
// the original file happened to put it.
type entry struct {
	tag   uint16
	typ   uint16
	count uint32
	value []byte
}

// filterExif reads the TIFF block inside an Exif segment and writes a new one
// holding only the kept tags. It returns nil when nothing survives, so the
// caller can leave the segment out rather than write an empty one.
func filterExif(tiff []byte) []byte {
	if len(tiff) < 8 {
		return nil
	}
	var order binary.ByteOrder
	switch {
	case tiff[0] == 'I' && tiff[1] == 'I':
		order = binary.LittleEndian
	case tiff[0] == 'M' && tiff[1] == 'M':
		order = binary.BigEndian
	default:
		return nil
	}
	if order.Uint16(tiff[2:]) != 42 {
		return nil
	}

	ifd0 := readIFD(tiff, order, order.Uint32(tiff[4:]))
	var exifIn, gpsIn []entry
	for _, e := range ifd0 {
		switch e.tag {
		case tagExifIFD:
			exifIn = readIFD(tiff, order, valueOffset(e, order))
		case tagGPSIFD:
			gpsIn = readIFD(tiff, order, valueOffset(e, order))
		}
	}

	out0 := pick(ifd0, keepIFD0)
	outExif := pick(exifIn, keepExif)
	// The GPS directory is kept whole.
	outGPS := gpsIn

	if len(out0) == 0 && len(outExif) == 0 && len(outGPS) == 0 {
		return nil
	}
	return writeTIFF(out0, outExif, outGPS)
}

// readIFD reads one directory. A record pointing outside the block, or using
// a type of unknown width, is skipped rather than trusted.
func readIFD(tiff []byte, order binary.ByteOrder, off uint32) []entry {
	if off == 0 || uint64(off)+2 > uint64(len(tiff)) {
		return nil
	}
	n := uint32(order.Uint16(tiff[off:]))
	// A directory claiming more records than the block could hold is corrupt.
	if uint64(off)+2+uint64(n)*12 > uint64(len(tiff)) {
		return nil
	}
	out := make([]entry, 0, n)
	for i := uint32(0); i < n; i++ {
		rec := tiff[off+2+i*12:]
		e := entry{
			tag:   order.Uint16(rec),
			typ:   order.Uint16(rec[2:]),
			count: order.Uint32(rec[4:]),
		}
		w, ok := typeSize[e.typ]
		if !ok {
			continue
		}
		size := uint64(w) * uint64(e.count)
		if size > 4 {
			p := uint64(order.Uint32(rec[8:]))
			if p+size > uint64(len(tiff)) {
				continue
			}
			e.value = tiff[p : p+size]
		} else {
			e.value = rec[8 : 8+size]
		}
		// Re-encode multi-byte values in the order the new block is written
		// in, which is always big-endian.
		e.value = reorder(e.value, e.typ, e.count, order)
		out = append(out, e)
	}
	return out
}

// reorder rewrites a value from the file's byte order into big-endian, which
// is what writeTIFF emits. A byte or ASCII value is the same either way.
func reorder(v []byte, typ uint16, count uint32, order binary.ByteOrder) []byte {
	if order == binary.BigEndian {
		return v
	}
	w := typeSize[typ]
	if w < 2 {
		return v
	}
	// A RATIONAL is two 4-byte halves, not one 8-byte number.
	unit := w
	if typ == 5 || typ == 10 {
		unit = 4
		count *= 2
	}
	out := make([]byte, len(v))
	copy(out, v)
	for i := uint32(0); i < count; i++ {
		s := out[i*unit : (i+1)*unit]
		for a, b := 0, len(s)-1; a < b; a, b = a+1, b-1 {
			s[a], s[b] = s[b], s[a]
		}
	}
	return out
}

func valueOffset(e entry, order binary.ByteOrder) uint32 {
	if len(e.value) < 4 {
		return 0
	}
	// e.value was already turned big-endian by readIFD.
	_ = order
	return binary.BigEndian.Uint32(e.value)
}

func pick(list []entry, keep map[uint16]bool) []entry {
	var out []entry
	for _, e := range list {
		if keep[e.tag] {
			out = append(out, e)
		}
	}
	return out
}

// writeRecord writes one 12-byte directory record, putting the value inline
// when it fits and in the data area when it does not.
func writeRecord(rec *bytes.Buffer, e entry, at uint32, data *bytes.Buffer) {
	var b [12]byte
	binary.BigEndian.PutUint16(b[0:], e.tag)
	binary.BigEndian.PutUint16(b[2:], e.typ)
	binary.BigEndian.PutUint32(b[4:], e.count)
	if len(e.value) > 4 {
		binary.BigEndian.PutUint32(b[8:], at)
		data.Write(e.value)
		if len(e.value)%2 == 1 {
			data.WriteByte(0) // Records start on an even boundary.
		}
	} else {
		copy(b[8:], e.value)
	}
	rec.Write(b[:])
}

// writeTIFF lays out a new big-endian TIFF block: the main directory, then
// the Exif and GPS directories it points at, then the values too large to sit
// inside a record.
func writeTIFF(ifd0, exif, gps []entry) []byte {
	sortByTag(ifd0)
	sortByTag(exif)
	sortByTag(gps)

	// The main directory gains a pointer for each sub-directory that has
	// anything in it.
	n0 := len(ifd0)
	if len(exif) > 0 {
		n0++
	}
	if len(gps) > 0 {
		n0++
	}

	size := func(n int) uint32 { return uint32(2 + 12*n + 4) }
	const headerLen = 8
	exifAt := headerLen + size(n0)
	gpsAt := exifAt
	if len(exif) > 0 {
		gpsAt += size(len(exif))
	}
	dataAt := gpsAt
	if len(gps) > 0 {
		dataAt += size(len(gps))
	}

	var data bytes.Buffer

	// The pointers are ordinary records, and have to be filed in tag order
	// with the rest.
	full := append([]entry{}, ifd0...)
	if len(exif) > 0 {
		full = append(full, longEntry(tagExifIFD, exifAt))
	}
	if len(gps) > 0 {
		full = append(full, longEntry(tagGPSIFD, gpsAt))
	}
	sortByTag(full)

	var dir0, dirExif, dirGPS bytes.Buffer
	for _, e := range full {
		writeRecord(&dir0, e, dataAt+uint32(data.Len()), &data)
	}
	for _, e := range exif {
		writeRecord(&dirExif, e, dataAt+uint32(data.Len()), &data)
	}
	for _, e := range gps {
		writeRecord(&dirGPS, e, dataAt+uint32(data.Len()), &data)
	}

	var out bytes.Buffer
	out.Write([]byte{'M', 'M', 0, 42})
	var off [4]byte
	binary.BigEndian.PutUint32(off[:], headerLen)
	out.Write(off[:])

	writeDir(&out, len(full), &dir0)
	if len(exif) > 0 {
		writeDir(&out, len(exif), &dirExif)
	}
	if len(gps) > 0 {
		writeDir(&out, len(gps), &dirGPS)
	}
	out.Write(data.Bytes())
	return out.Bytes()
}

// writeDir writes a directory: how many records, the records, then the offset
// of the directory after it, which is always zero here because nothing in
// this block chains onward. That is what drops the embedded thumbnail.
func writeDir(out *bytes.Buffer, n int, records *bytes.Buffer) {
	var b [2]byte
	binary.BigEndian.PutUint16(b[:], uint16(n))
	out.Write(b[:])
	out.Write(records.Bytes())
	out.Write([]byte{0, 0, 0, 0})
}

func longEntry(tag uint16, v uint32) entry {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, v)
	return entry{tag: tag, typ: 4, count: 1, value: b}
}

// sortByTag puts records in ascending tag order, which the TIFF specification
// requires and some readers rely on.
func sortByTag(list []entry) {
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && list[j-1].tag > list[j].tag; j-- {
			list[j-1], list[j] = list[j], list[j-1]
		}
	}
}
