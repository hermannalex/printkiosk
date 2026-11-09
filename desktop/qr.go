package main

// QR Code encoder (byte mode, error correction M), after Project Nayuki's reference
// implementation. Used for the Pix code, the guest Wi-Fi and the phone upload link.

import (
	"errors"
	"fmt"
	"strings"
)

var eccPerBlockM = [41]int{-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28}
var numBlocksM = [41]int{-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49}

type qrCode struct {
	size     int
	modules  [][]bool
	function [][]bool
}

func rawDataModules(ver int) int {
	result := (16*ver+128)*ver + 64
	if ver >= 2 {
		numAlign := ver/7 + 2
		result -= (25*numAlign-10)*numAlign - 55
		if ver >= 7 {
			result -= 36
		}
	}
	return result
}

func dataCodewords(ver int) int {
	return rawDataModules(ver)/8 - eccPerBlockM[ver]*numBlocksM[ver]
}

// EncodeQR returns the module matrix for the text (true = dark).
func EncodeQR(text string) (*qrCode, error) {
	data := []byte(text)
	ver := 1
	for ; ver <= 40; ver++ {
		countBits := 8
		if ver >= 10 {
			countBits = 16
		}
		if 4+countBits+len(data)*8 <= dataCodewords(ver)*8 {
			break
		}
	}
	if ver > 40 {
		return nil, errors.New("texto longo demais para um QR Code")
	}
	countBits := 8
	if ver >= 10 {
		countBits = 16
	}
	var bits []bool
	put := func(value, n int) {
		for i := n - 1; i >= 0; i-- {
			bits = append(bits, (value>>i)&1 == 1)
		}
	}
	put(4, 4)
	put(len(data), countBits)
	for _, b := range data {
		put(int(b), 8)
	}
	capacity := dataCodewords(ver) * 8
	for i := 0; i < 4 && len(bits) < capacity; i++ {
		bits = append(bits, false)
	}
	for len(bits)%8 != 0 {
		bits = append(bits, false)
	}
	for pad := 0xEC; len(bits) < capacity; pad ^= 0xEC ^ 0x11 {
		put(pad, 8)
	}
	codewords := make([]byte, len(bits)/8)
	for i, b := range bits {
		if b {
			codewords[i>>3] |= 1 << (7 - uint(i&7))
		}
	}

	q := &qrCode{size: ver*4 + 17}
	q.modules = make([][]bool, q.size)
	q.function = make([][]bool, q.size)
	for i := range q.modules {
		q.modules[i] = make([]bool, q.size)
		q.function[i] = make([]bool, q.size)
	}
	q.drawFunctionPatterns(ver)
	q.drawCodewords(addEccAndInterleave(codewords, ver))

	best, bestPenalty := 0, -1
	for mask := 0; mask < 8; mask++ {
		q.applyMask(mask)
		q.drawFormatBits(mask)
		if p := q.penalty(); bestPenalty < 0 || p < bestPenalty {
			best, bestPenalty = mask, p
		}
		q.applyMask(mask)
	}
	q.applyMask(best)
	q.drawFormatBits(best)
	return q, nil
}

func (q *qrCode) set(x, y int, dark bool) {
	q.modules[y][x] = dark
	q.function[y][x] = true
}

func (q *qrCode) drawFunctionPatterns(ver int) {
	for i := 0; i < q.size; i++ {
		q.set(6, i, i%2 == 0)
		q.set(i, 6, i%2 == 0)
	}
	q.drawFinder(3, 3)
	q.drawFinder(q.size-4, 3)
	q.drawFinder(3, q.size-4)
	pos := alignmentPositions(ver, q.size)
	n := len(pos)
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if (i == 0 && j == 0) || (i == 0 && j == n-1) || (i == n-1 && j == 0) {
				continue
			}
			for dy := -2; dy <= 2; dy++ {
				for dx := -2; dx <= 2; dx++ {
					q.set(pos[i]+dx, pos[j]+dy, max(abs(dx), abs(dy)) != 1)
				}
			}
		}
	}
	q.drawFormatBits(0)
	if ver >= 7 {
		rem := ver
		for i := 0; i < 12; i++ {
			rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
		}
		bits := ver<<12 | rem
		for i := 0; i < 18; i++ {
			bit := (bits>>i)&1 == 1
			a, b := q.size-11+i%3, i/3
			q.set(a, b, bit)
			q.set(b, a, bit)
		}
	}
}

func (q *qrCode) drawFinder(x, y int) {
	for dy := -4; dy <= 4; dy++ {
		for dx := -4; dx <= 4; dx++ {
			xx, yy := x+dx, y+dy
			if xx >= 0 && xx < q.size && yy >= 0 && yy < q.size {
				d := max(abs(dx), abs(dy))
				q.set(xx, yy, d != 2 && d != 4)
			}
		}
	}
}

func alignmentPositions(ver, size int) []int {
	if ver == 1 {
		return nil
	}
	numAlign := ver/7 + 2
	step := (ver*8 + numAlign*3 + 5) / (numAlign*4 - 4) * 2
	result := []int{6}
	var rest []int
	for pos := size - 7; len(rest) < numAlign-1; pos -= step {
		rest = append([]int{pos}, rest...)
	}
	return append(result, rest...)
}

func (q *qrCode) drawFormatBits(mask int) {
	data := 0<<3 | mask // error correction M = 00
	rem := data
	for i := 0; i < 10; i++ {
		rem = (rem << 1) ^ ((rem >> 9) * 0x537)
	}
	bits := (data<<10 | rem) ^ 0x5412
	bit := func(i int) bool { return (bits>>i)&1 == 1 }
	for i := 0; i <= 5; i++ {
		q.set(8, i, bit(i))
	}
	q.set(8, 7, bit(6))
	q.set(8, 8, bit(7))
	q.set(7, 8, bit(8))
	for i := 9; i < 15; i++ {
		q.set(14-i, 8, bit(i))
	}
	for i := 0; i < 8; i++ {
		q.set(q.size-1-i, 8, bit(i))
	}
	for i := 8; i < 15; i++ {
		q.set(8, q.size-15+i, bit(i))
	}
	q.set(8, q.size-8, true)
}

func addEccAndInterleave(data []byte, ver int) []byte {
	numBlocks := numBlocksM[ver]
	eccLen := eccPerBlockM[ver]
	raw := rawDataModules(ver) / 8
	numShort := numBlocks - raw%numBlocks
	shortLen := raw / numBlocks
	divisor := rsDivisor(eccLen)
	blocks := make([][]byte, 0, numBlocks)
	k := 0
	for i := 0; i < numBlocks; i++ {
		n := shortLen - eccLen
		if i >= numShort {
			n++
		}
		dat := append([]byte{}, data[k:k+n]...)
		k += n
		ecc := rsRemainder(dat, divisor)
		if i < numShort {
			dat = append(dat, 0)
		}
		blocks = append(blocks, append(dat, ecc...))
	}
	var out []byte
	for i := range blocks[0] {
		for j, b := range blocks {
			if i != shortLen-eccLen || j >= numShort {
				out = append(out, b[i])
			}
		}
	}
	return out
}

func gfMul(x, y byte) byte {
	z := 0
	for i := 7; i >= 0; i-- {
		z = (z << 1) ^ ((z >> 7) * 0x11D)
		z ^= int((y>>uint(i))&1) * int(x)
	}
	return byte(z)
}

func rsDivisor(degree int) []byte {
	result := make([]byte, degree)
	result[degree-1] = 1
	root := byte(1)
	for i := 0; i < degree; i++ {
		for j := range result {
			result[j] = gfMul(result[j], root)
			if j+1 < len(result) {
				result[j] ^= result[j+1]
			}
		}
		root = gfMul(root, 2)
	}
	return result
}

func rsRemainder(data, divisor []byte) []byte {
	result := make([]byte, len(divisor))
	for _, b := range data {
		factor := b ^ result[0]
		copy(result, result[1:])
		result[len(result)-1] = 0
		for i := range result {
			result[i] ^= gfMul(divisor[i], factor)
		}
	}
	return result
}

func (q *qrCode) drawCodewords(data []byte) {
	i := 0
	for right := q.size - 1; right >= 1; right -= 2 {
		if right == 6 {
			right = 5
		}
		for vert := 0; vert < q.size; vert++ {
			for j := 0; j < 2; j++ {
				x := right - j
				y := vert
				if (right+1)&2 == 0 {
					y = q.size - 1 - vert
				}
				if !q.function[y][x] && i < len(data)*8 {
					q.modules[y][x] = (data[i>>3]>>(7-uint(i&7)))&1 == 1
					i++
				}
			}
		}
	}
}

func (q *qrCode) applyMask(mask int) {
	for y := 0; y < q.size; y++ {
		for x := 0; x < q.size; x++ {
			var invert bool
			switch mask {
			case 0:
				invert = (x+y)%2 == 0
			case 1:
				invert = y%2 == 0
			case 2:
				invert = x%3 == 0
			case 3:
				invert = (x+y)%3 == 0
			case 4:
				invert = (x/3+y/2)%2 == 0
			case 5:
				invert = x*y%2+x*y%3 == 0
			case 6:
				invert = (x*y%2+x*y%3)%2 == 0
			case 7:
				invert = ((x+y)%2+x*y%3)%2 == 0
			}
			if invert && !q.function[y][x] {
				q.modules[y][x] = !q.modules[y][x]
			}
		}
	}
}

// penalty: runs of the same color, 2x2 blocks, finder-like patterns, dark/light balance.
func (q *qrCode) penalty() int {
	n := q.size
	p := 0
	line := func(get func(i int) bool) {
		run := 1
		for i := 1; i < n; i++ {
			if get(i) == get(i-1) {
				run++
			} else {
				if run >= 5 {
					p += run - 2
				}
				run = 1
			}
		}
		if run >= 5 {
			p += run - 2
		}
		pattern := []bool{true, false, true, true, true, false, true}
		for i := 0; i+7 <= n; i++ {
			match := true
			for k := 0; k < 7 && match; k++ {
				match = get(i+k) == pattern[k]
			}
			if !match {
				continue
			}
			lightBefore := i >= 4
			for k := 1; k <= 4 && lightBefore; k++ {
				lightBefore = !get(i - k)
			}
			lightAfter := i+11 <= n
			for k := 7; k < 11 && lightAfter; k++ {
				lightAfter = !get(i + k)
			}
			if lightBefore || lightAfter {
				p += 40
			}
		}
	}
	for y := 0; y < n; y++ {
		line(func(i int) bool { return q.modules[y][i] })
	}
	for x := 0; x < n; x++ {
		line(func(i int) bool { return q.modules[i][x] })
	}
	dark := 0
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			if q.modules[y][x] {
				dark++
			}
			if x+1 < n && y+1 < n {
				c := q.modules[y][x]
				if c == q.modules[y][x+1] && c == q.modules[y+1][x] && c == q.modules[y+1][x+1] {
					p += 3
				}
			}
		}
	}
	total := n * n
	k := (abs(dark*20-total*10)+total-1)/total - 1
	if k > 0 {
		p += k * 10
	}
	return p
}

// SVG renders the code with a 4-module quiet zone; it scales to any size.
func (q *qrCode) SVG() string {
	border := 4
	dim := q.size + border*2
	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges"><rect width="100%%" height="100%%" fill="#fff"/><path fill="#000" d="`, dim, dim)
	for y := 0; y < q.size; y++ {
		for x := 0; x < q.size; x++ {
			if q.modules[y][x] {
				fmt.Fprintf(&b, "M%d,%dh1v1h-1z", x+border, y+border)
			}
		}
	}
	b.WriteString(`"/></svg>`)
	return b.String()
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
