# Re-grid sprite art onto one shared texel density (PX_PER_M texels per metre, matching the
# ground textures). For every sprite a ladder of pixel heights is written to native/px_<name>_<H>.png;
# props.js / characters.js pick the rung closest to h * PX_PER_M at runtime.
#  - downscaling: area filter from the ~5x master art, then snapped to a reduced palette (no smooth gradients)
#  - upscaling: palette-snap the native art, Scale2x (EPX) until big enough (smooths staircase edges
#    without inventing blur), then area-downscale + palette snap to the exact rung.
# Also generates the leaf-clump cards used for the volumetric oak canopies.
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
NAT, SRC = os.path.join(HERE, 'native'), os.path.join(HERE, 'sprites')
PX_PER_M = 56

def rgba(path): return np.array(Image.open(path).convert('RGBA'))

def palette_of(a, n):
    m = a[..., 3] > 127
    px = a[m][:, :3].reshape(1, -1, 3)
    return Image.fromarray(px.astype(np.uint8), 'RGB').quantize(colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

def snap(a, pal):
    rgb = Image.fromarray(a[..., :3].copy(), 'RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB')
    out = np.dstack([np.array(rgb), np.where(a[..., 3] > 127, 255, 0).astype(np.uint8)])
    out[out[..., 3] == 0, :3] = 0
    return out

def area_down(a, w, h):
    f = a.astype(np.float32) / 255.0
    pm = f.copy(); pm[..., :3] *= pm[..., 3:4]
    im = [Image.fromarray(pm[..., c]).resize((w, h), Image.BOX) for c in range(4)]
    r = np.dstack([np.array(i) for i in im])
    al = r[..., 3:4]
    r[..., :3] = np.where(al > 1e-4, r[..., :3] / np.maximum(al, 1e-4), 0)
    return (np.clip(r, 0, 1) * 255 + 0.5).astype(np.uint8)

def scale2x(a):
    h, w = a.shape[:2]
    key = a.astype(np.int64)
    key = (key[..., 0] << 24) | (key[..., 1] << 16) | (key[..., 2] << 8) | key[..., 3]
    p = np.pad(key, 1, mode='edge')
    A, B, C, D, E = p[:-2, 1:-1], p[1:-1, 2:], p[1:-1, :-2], p[2:, 1:-1], key
    pa = np.pad(a, ((1, 1), (1, 1), (0, 0)), mode='edge')
    An, Bn, Cn, Dn = pa[:-2, 1:-1], pa[1:-1, 2:], pa[1:-1, :-2], pa[2:, 1:-1]
    out = np.zeros((h * 2, w * 2, 4), np.uint8)
    e0 = (C == A) & (C != D) & (A != B)
    e1 = (A == B) & (A != C) & (B != D)
    e2 = (D == C) & (D != B) & (C != A)
    e3 = (B == D) & (B != A) & (D != C)
    out[0::2, 0::2] = np.where(e0[..., None], An, a)
    out[0::2, 1::2] = np.where(e1[..., None], Bn, a)
    out[1::2, 0::2] = np.where(e2[..., None], Cn, a)
    out[1::2, 1::2] = np.where(e3[..., None], Dn, a)
    return out

def make(name, H, ncol):
    nat = rgba(os.path.join(NAT, name + '.png'))
    src = rgba(os.path.join(SRC, name + '.png'))
    pal = palette_of(nat, ncol)
    nh, nw = nat.shape[:2]
    W = max(1, round(nw * H / nh))
    if H <= nh * 1.05:
        out = snap(area_down(src, W, H), pal)
    else:
        b = snap(nat, pal)
        while b.shape[0] < H * 1.4: b = scale2x(b)
        out = snap(area_down(b, W, H), pal)
    return out

# name -> (list of heights in metres to cover, palette size)
LADDER = 1.16
SPEC = {
    'oak': ((4.2, 10.5), 40), 'pine': ((4.5, 11.0), 32),
    'lamp': ((2.2, 3.4), 24), 'well': ((1.4, 2.2), 28), 'barrel': ((0.4, 1.0), 20), 'crate': ((0.4, 0.9), 20),
    'bush': ((0.55, 1.6), 24), 'flowers': ((0.38, 0.65), 20), 'fence': ((0.8, 1.1), 20),
    'great_lantern': ((4.5, 7.0), 40),
}
# Characters: one crisp, outlined rung each on their own (chunkier) texel grid. Sized for an in-world
# height of PIP_H-multiple * CHAR_SCALE metres at CHAR_PX_PER_M texels per metre, so the party reads
# ~100-130 px tall at 1080p in the hero shot with every texel ~1.6 screen px. Walk-cycle frames
# (pip_*/moss_*) are emitted too. pxName() returns the single rung whatever height is asked for.
CHAR_SCALE, CHAR_PX_PER_M = 1.6, 42
CHARS = {'mayor': 1.11, 'baker': 1.07, 'guard': 1.16, 'kid': 0.95, 'zuzu': 1.09}
for _who, _hm in (('pip', 0.95), ('moss', 0.98)):
    for _d in ('down', 'right', 'up'):
        for _f in range(4): CHARS[f'{_who}_{_d}_{_f}'] = _hm

def outline(a):
    """1-texel selective dark outline on the silhouette rim (inside the mask, so the size is kept)."""
    m = a[..., 3] > 127
    p = np.pad(m, 1)
    inner = p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    rim = m & ~inner
    o = a.copy()
    c = a[..., :3].astype(np.float32)
    dark = c * 0.26 + np.array([10, 6, 14], np.float32)
    o[rim, :3] = np.clip(dark[rim], 0, 255).astype(np.uint8)
    return o

def make_char(name, H):
    nat = rgba(os.path.join(NAT, name + '.png'))
    src = rgba(os.path.join(SRC, name + '.png'))
    nh, nw = nat.shape[:2]
    pal = palette_of(nat, 18)
    if abs(H - nh) <= max(3, nh * 0.06):
        out = snap(nat, pal)            # native art is already at this size: keep every hand-placed texel
    else:
        W = max(1, round(nw * H / nh))
        out = snap(area_down(src, W, H), pal)
    return outline(out)

def rungs(lo, hi):
    hs, h = [], lo * PX_PER_M
    while h < hi * PX_PER_M * LADDER: hs.append(int(round(h))); h *= LADDER
    return hs

def main():
    out = {}
    for f in os.listdir(NAT):
        if f.startswith('px_'): os.remove(os.path.join(NAT, f))
    for name, ((lo, hi), ncol) in SPEC.items():
        out[name] = []
        for H in rungs(lo, hi):
            a = make(name, H, ncol)
            Image.fromarray(a).save(os.path.join(NAT, f'px_{name}_{H}.png'), optimize=True)
            out[name].append(H)
    for name, hm in CHARS.items():
        if not os.path.exists(os.path.join(NAT, name + '.png')): continue
        H = int(round(hm * CHAR_SCALE * CHAR_PX_PER_M))
        a = make_char(name, H)
        H = a.shape[0]
        Image.fromarray(a).save(os.path.join(NAT, f'px_{name}_{H}.png'), optimize=True)
        out[name] = [H]
    json.dump({'pxPerM': PX_PER_M, 'rungs': out}, open(os.path.join(HERE, 'pxgrid.json'), 'w'), indent=0)
    print(json.dumps(out))

if __name__ == '__main__':
    main()

# ---------------- oak trunk (canopy removed) + leaf clump cards cut from the oak art ----------------
def leafmask(a):
    r, g, b = [a[..., i].astype(int) for i in range(3)]
    return (a[..., 3] > 127) & (g * 100 >= r * 86) & (g > b + 6)

def flood(m, y0, x0):
    out = np.zeros_like(m); st = [(y0, x0)]
    while st:
        y, x = st.pop()
        if 0 <= y < m.shape[0] and 0 <= x < m.shape[1] and m[y, x] and not out[y, x]:
            out[y, x] = True; st += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    return out

RAMP = np.array([[18, 30, 26], [26, 48, 36], [36, 70, 40], [58, 98, 44], [96, 132, 52], [150, 172, 66], [206, 206, 98]], np.uint8)
LEAVES = [np.array(p) for p in (
    [[0, 1, 1, 0], [1, 1, 1, 1], [1, 1, 1, 0], [0, 1, 0, 0]],
    [[0, 1, 0], [1, 1, 1], [1, 1, 1], [0, 1, 0]],
    [[1, 1, 0, 0], [1, 1, 1, 0], [0, 1, 1, 1], [0, 0, 1, 1]],
    [[0, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 0], [1, 1, 0, 0]],
    [[0, 1, 1, 0], [1, 1, 1, 1], [0, 1, 1, 0]],
)]

def leaf_clumps(nvar=6, W=50, H=46):
    rs = np.random.RandomState(11)
    Lg = np.array([-0.45, -0.75, 0.5]); Lg /= np.linalg.norm(Lg)
    for v in range(nvar):
        img = np.zeros((H, W, 4), np.uint8)
        rx, ry = W / 2 - 4, H / 2 - 4
        pts = []
        for k in range(330):
            while True:
                x, y = rs.rand() * 2 - 1, rs.rand() * 2 - 1
                # lumpy outline: radius modulated by angle
                a = np.arctan2(y, x); lim = 0.84 + 0.16 * np.sin(a * 5 + v * 1.7) * np.cos(a * 3 + v)
                if x * x + y * y < lim * lim: break
            z = np.sqrt(max(0.0, 1 - x * x - y * y))
            pts.append((z, x, y))
        pts.sort()
        for z, x, y in pts:
            n = np.array([x, y, z]); it = max(0.0, n @ Lg) * 0.95 + 0.08 * z + (rs.rand() - 0.5) * 0.22
            ci = int(np.clip(round(it * 6), 0, 6))
            lf = LEAVES[rs.randint(len(LEAVES))]
            if rs.rand() < 0.5: lf = lf[:, ::-1]
            px, py = int(W / 2 + x * rx - lf.shape[1] / 2), int(H / 2 + y * ry - lf.shape[0] / 2)
            for (dy, dx) in zip(*np.nonzero(lf)):
                yy, xx = py + dy, px + dx
                if 0 <= yy < H and 0 <= xx < W:
                    c = ci
                    if dy == lf.shape[0] - 1 or (dx == lf.shape[1] - 1 and ci > 1): c = max(0, ci - 1)  # leaf underside
                    img[yy, xx, :3] = RAMP[c]; img[yy, xx, 3] = 255
            # bright tip on lit leaves
            if ci >= 4:
                yy, xx = py + 1, px + 1
                if 0 <= yy < H and 0 <= xx < W and img[yy, xx, 3]: img[yy, xx, :3] = RAMP[min(6, ci + 1)]
        for _ in range(2):
            m = img[..., 3] > 0
            nb = np.roll(m, 1, 0).astype(int) + np.roll(m, -1, 0) + np.roll(m, 1, 1) + np.roll(m, -1, 1)
            hole = (~m) & (nb >= 3)
            img[hole, :3] = RAMP[1]; img[hole, 3] = 255
        m = img[..., 3] > 0
        edge = m & ~(np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1))
        img[edge & (np.arange(H)[:, None] > H * 0.35), :3] = RAMP[0]
        Image.fromarray(img).save(os.path.join(NAT, f'px_leafclump_{v}.png'), optimize=True)

def oak_extras(oak_rungs):
    for H in oak_rungs:
        a = np.array(Image.open(os.path.join(NAT, f'px_oak_{H}.png')).convert('RGBA'))
        h = a.shape[0]
        yy = np.arange(h)[:, None] / h
        r, g, b = [a[..., i].astype(int) for i in range(3)]
        brown = (r * 100 > g * 112) & (r > b + 18)
        kill = ((~brown) & (yy < 0.76)) | (leafmask(a) & (yy < 0.8)) | (yy < 0.36)
        t = a.copy(); t[kill] = 0
        # drop small islands (stray leaf-outline pixels)
        m = t[..., 3] > 0; seen = np.zeros_like(m)
        for y0, x0 in zip(*np.nonzero(m)):
            if seen[y0, x0]: continue
            comp = flood(m & ~seen, y0, x0); seen |= comp
            if comp.sum() < 40: t[comp] = 0
        for y in range(int(h * 0.55), h):  # restore bark between the trunk's outer edges (moss highlights)
            xs = np.nonzero(t[y, :, 3] > 0)[0]
            if len(xs) > 1:
                seg = slice(xs[0], xs[-1] + 1)
                rest = (t[y, seg, 3] == 0) & (a[y, seg, 3] > 0) & ~leafmask(a[y:y + 1, seg])[0] if False else (t[y, seg, 3] == 0) & (a[y, seg, 3] > 0)
                # only short gaps (holes), not the space between two separate branches
                run = 0; idx = np.nonzero(rest)[0]
                row = t[y, seg]; src_row = a[y, seg]
                if len(idx):
                    groups = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
                    for g_ in groups:
                        if len(g_) <= max(4, h // 22): row[g_] = src_row[g_]
        for _ in range(2):  # refill pin-holes inside the bark
            m = t[..., 3] > 0
            nb = np.roll(m, 1, 0).astype(int) + np.roll(m, -1, 0) + np.roll(m, 1, 1) + np.roll(m, -1, 1)
            hole = (~m) & (nb >= 3) & (a[..., 3] > 0)
            t[hole] = a[hole]
        Image.fromarray(t).save(os.path.join(NAT, f'px_oaktrunk_{H}.png'), optimize=True)
    leaf_clumps()
    print('clumps done')

if __name__ == '__main__':
    oak_extras(json.load(open(os.path.join(HERE, 'pxgrid.json')))['rungs']['oak'])
