import numpy as np
from PIL import Image
from collections import deque

def label(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32); n = 0
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not lab[y, x]:
                n += 1; q = deque([(y, x)]); lab[y, x] = n
                while q:
                    cy, cx = q.popleft()
                    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny, nx = cy+dy, cx+dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; q.append((ny, nx))
    return lab, n

def components(a, k=4, dil=1, min_area=80):
    """connected components of the alpha mask, computed on a k-times downsampled grid"""
    al = a[..., 3] > 100
    h, w = al.shape
    hs, ws = (h + k - 1) // k, (w + k - 1) // k
    pad = np.zeros((hs * k, ws * k), bool); pad[:h, :w] = al
    small = pad.reshape(hs, k, ws, k).any(axis=(1, 3))
    for _ in range(dil):
        s = small.copy()
        s[1:] |= small[:-1]; s[:-1] |= small[1:]; s[:, 1:] |= small[:, :-1]; s[:, :-1] |= small[:, 1:]
        small = s
    lab, n = label(small)
    boxes = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        if len(ys) < min_area: continue
        boxes.append([ys.min() * k, ys.max() * k + k, xs.min() * k, xs.max() * k + k, lab, i, k])
    return boxes

def order(boxes):
    """reading order: group into rows by vertical centre, then left to right"""
    boxes = sorted(boxes, key=lambda b: (b[0] + b[1]) / 2)
    rows = []
    for b in boxes:
        c = (b[0] + b[1]) / 2
        if rows and abs(c - rows[-1][0]) < (b[1] - b[0]) * 0.45: rows[-1][1].append(b)
        else: rows.append([c, [b]])
    out = []
    for _, r in rows: out += sorted(r, key=lambda b: b[2])
    return out

def cut(a, b):
    y0, y1, x0, x1, lab, i, k = b
    sub = a[y0:y1, x0:x1].copy()
    # drop pixels belonging to other components that fall inside this box
    full = np.kron(lab == i, np.ones((k, k), bool))
    full = np.pad(full, ((0, max(0, y1 - full.shape[0])), (0, max(0, x1 - full.shape[1]))))
    own = full[y0:y1, x0:x1][:sub.shape[0], :sub.shape[1]]
    sub[..., 3] = np.where(own, sub[..., 3], 0)
    # trim to content
    ys, xs = np.nonzero(sub[..., 3] > 100)
    return sub[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

SHEETS = {
    'props': ['oak', 'pine', 'bush', 'flowers', 'lamp', 'barrel', 'crate', 'fence', 'well'],
    'house_details': ['door_pink', 'door_oak', 'sign_bakery', 'chimney', 'window_shutter', 'window_awning', 'window_lattice'],
    'villagers': ['mayor', 'baker', 'guard', 'kid', 'zuzu'],
    'great_lantern': ['great_lantern'],
    'pip_sheet': [f'pip_{d}_{f}' for d in ('down', 'up', 'right') for f in range(4)],
    'moss_sheet': [f'moss_{d}_{f}' for d in ('down', 'up', 'right') for f in range(4)],
}
for sheet, names in SHEETS.items():
    a = np.array(Image.open(f'raw/{sheet}.png').convert('RGBA'))
    bs = order(components(a))
    print(sheet, len(bs), 'pieces', '(expected', len(names), ')')
    for j, b in enumerate(bs):
        nm = names[j] if j < len(names) else f'{sheet}_extra{j}'
        c = cut(a, b)
        Image.fromarray(c).save(f'sprites/{nm}.png')
        print('  ', nm, c.shape[1], 'x', c.shape[0])

# texture sheets: 2x2 squares separated by black gutters
for sheet, names in {'building_textures': ['tex_timber', 'tex_planks', 'tex_shingles', 'tex_stonebrick'],
                     'ground_textures': ['tex_cobble', 'tex_grass', 'tex_dirt', 'tex_cliff']}.items():
    a = np.array(Image.open(f'raw/{sheet}.png').convert('RGB')).astype(int)
    black = a.sum(axis=2) < 40
    cols = np.nonzero(black.mean(axis=0) < 0.9)[0]; rows = np.nonzero(black.mean(axis=1) < 0.9)[0]
    def runs(v):
        out = []; s = v[0]; p = v[0]
        for x in v[1:]:
            if x != p + 1: out.append((s, p + 1)); s = x
            p = x
        out.append((s, p + 1)); return [r for r in out if r[1] - r[0] > 100]
    cr, rr = runs(cols), runs(rows)
    print(sheet, 'cols', cr, 'rows', rr)
    j = 0
    for (y0, y1) in rr:
        for (x0, x1) in cr:
            m = 6  # trim inner border
            Image.fromarray(a[y0 + m:y1 - m, x0 + m:x1 - m].astype(np.uint8)).save(f'sprites/{names[j]}.png'); j += 1
