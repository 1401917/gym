"""Generate PNG icons for the PWA from scratch using only stdlib."""
import struct, zlib, math, os

def write_png(path, width, height, pixels):
    """pixels: flat list of (r,g,b,a) tuples, row by row."""
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            r,g,b,a = pixels[y*width+x]
            raw += bytes([r,g,b,a])
    compressed = zlib.compress(raw, 9)

    out  = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)[:13])
    # RGBA = colour type 6
    out  = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>II', width, height) + bytes([8, 6, 0, 0, 0])
    out += chunk(b'IHDR', ihdr)
    out += chunk(b'IDAT', compressed)
    out += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(out)

def lerp(a, b, t):
    return a + (b - a) * t

def draw_icon(size):
    pixels = []
    cx = cy = size / 2
    r = size / 2

    # colours
    blue  = (37, 99, 235)
    orange= (249, 115, 22)

    radius = size / 2          # circle radius
    letter_scale = size / 512  # scale "P" relative to 512px reference

    for y in range(size):
        row = []
        for x in range(size):
            # distance from centre → circular mask
            dx = x - cx + 0.5
            dy = y - cy + 0.5
            dist = math.sqrt(dx*dx + dy*dy)

            if dist > radius:
                row.append((0, 0, 0, 0))
                continue

            # gradient: top-left=blue, bottom-right=orange
            t = (x / size + y / size) / 2
            bg_r = int(lerp(blue[0], orange[0], t))
            bg_g = int(lerp(blue[1], orange[1], t))
            bg_b = int(lerp(blue[2], orange[2], t))

            # soft anti-alias edge
            if dist > radius - 1.5:
                alpha = int(255 * (radius - dist) / 1.5)
            else:
                alpha = 255

            # draw a white "P" letter — properly centred at circle centre
            # All coords in 512-space, scaled by letter_scale
            # P total: ~180px wide, centred at (256,256)
            lx = x / letter_scale   # map screen pixel → 512-space
            ly = y / letter_scale

            # stem: x 166-236, y 146-366 (220px tall, 70px wide)
            in_stem  = (166 <= lx <= 236) and (146 <= ly <= 366)
            # bowl outer ellipse: centre (236,216), rx=100, ry=70
            box = (lx - 236) / 100
            boy = (ly - 216) / 70
            in_bowl_outer = (box*box + boy*boy <= 1.0) and (lx >= 166)
            # bowl inner cutout: centre (236,216), rx=62, ry=44
            bix = (lx - 236) / 62
            biy = (ly - 216) / 44
            in_bowl_inner = (bix*bix + biy*biy <= 1.0) and (lx >= 166)

            in_letter = in_stem or (in_bowl_outer and not in_bowl_inner)

            if in_letter:
                row.append((255, 255, 255, alpha))
            else:
                row.append((bg_r, bg_g, bg_b, alpha))
        pixels.extend(row)
    return pixels

os.makedirs('assets/icons', exist_ok=True)
for sz in (192, 512):
    print(f'Generating {sz}x{sz}...')
    px = draw_icon(sz)
    write_png(f'assets/icons/icon-{sz}.png', sz, sz, px)
    print(f'  -> assets/icons/icon-{sz}.png done')

print('All icons generated.')
