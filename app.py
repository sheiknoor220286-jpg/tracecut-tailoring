import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25 MB
WORK = 640  # working size in px; all output is normalised so this is invisible


@app.get("/")
def index():
    return render_template("index.html")


def norm(pts, pad, w, h):
    return [[round((x - pad) / w, 4), round((y - pad) / h, 4)] for x, y in pts.reshape(-1, 2)]


def garment_mask(img):
    """Solid garment mask with no holes: GrabCut first, colour-distance as a fallback."""
    h, w = img.shape[:2]
    m = max(4, int(0.02 * min(h, w)))
    gc = np.zeros((h, w), np.uint8)
    fg = None
    try:
        cv2.grabCut(img, gc, (m, m, w - 2 * m, h - 2 * m), np.zeros((1, 65)), np.zeros((1, 65)), 4, cv2.GC_INIT_WITH_RECT)
        fg = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    except cv2.error:
        pass
    if fg is None or not (0.03 < fg.mean() / 255 < 0.95):
        border = np.concatenate([img[0], img[-1], img[:, 0], img[:, -1]])
        diff = np.linalg.norm(img.astype(np.float32) - np.median(border, axis=0), axis=2)
        diff = cv2.GaussianBlur(np.clip(diff, 0, 255).astype(np.uint8), (7, 7), 0)
        _, fg = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, k, iterations=2)   # bridge gaps
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, k)                  # drop specks
    cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    solid = np.zeros_like(fg)
    if cnts:
        cv2.drawContours(solid, [max(cnts, key=cv2.contourArea)], -1, 255, cv2.FILLED)  # fills holes
    return cv2.medianBlur(solid, 9)


@app.post("/api/analyze")
def analyze():
    f = request.files.get("image")
    if not f:
        return jsonify(error="Upload an image first."), 400
    img = cv2.imdecode(np.frombuffer(f.read(), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return jsonify(error="That file isn't a readable image."), 400
    try:
        ref = max(float(request.form.get("ref", 70)), 1)
        seam = min(max(float(request.form.get("seam", 1.5)), 0), 10)
    except ValueError:
        return jsonify(error="Length and seam must be numbers."), 400

    s = WORK / max(img.shape[:2])
    img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    h, w = img.shape[:2]

    mask = garment_mask(img)
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cnt = max(cnts, key=cv2.contourArea) if cnts else None
    if cnt is None or cv2.contourArea(cnt) < 0.03 * w * h:
        mg = int(0.05 * min(w, h))
        cnt = np.array([[[mg, mg]], [[w - mg, mg]], [[w - mg, h - mg]], [[mg, h - mg]]], np.int32)
        mask = np.zeros((h, w), np.uint8)
        cv2.drawContours(mask, [cnt], -1, 255, cv2.FILLED)

    x, y, bw, bh = cv2.boundingRect(cnt)
    cm_px = ref / bh
    simp = lambda c: cv2.approxPolyDP(c, 0.0015 * cv2.arcLength(c, True), True)

    # Seam allowance: outline grown outward.
    seam_px = int(min(seam / cm_px, 100)); pad = seam_px + 4
    seam_pts = []
    if seam_px > 0:
        big = cv2.copyMakeBorder(mask, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * seam_px + 1,) * 2)
        g, _ = cv2.findContours(cv2.dilate(big, k), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        seam_pts = norm(simp(max(g, key=cv2.contourArea)), pad, w, h)

    # Inner detail lines (collar, placket, pockets, seams) from edges inside the garment.
    gray = cv2.createCLAHE(2.0, (8, 8)).apply(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 30, 90)
    inner = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    edges = cv2.morphologyEx(cv2.bitwise_and(edges, inner), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    ec, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    ec = sorted((c for c in ec if cv2.arcLength(c, False) > 0.08 * bh), key=lambda c: -cv2.arcLength(c, False))[:30]
    details = [norm(cv2.approxPolyDP(c, 2.0, False), 0, w, h) for c in ec]

    # Width guides across the piece.
    guides = []
    for fr in (0.25, 0.5, 0.75):
        row = np.where(mask[min(h - 1, y + int(fr * bh))] > 0)[0]
        if row.size:
            guides.append(dict(y=round((y + fr * bh) / h, 4), x0=round(row[0] / w, 4), x1=round(row[-1] / w, 4),
                               down_cm=round(fr * ref, 1), width_cm=round((row[-1] - row[0]) * cm_px, 1)))

    return jsonify(outline=norm(simp(cnt), 0, w, h), seam=seam_pts, details=details, guides=guides,
                   bbox=[x / w, y / h, bw / w, bh / h], length_cm=round(ref, 1), width_cm=round(bw * cm_px, 1))


if __name__ == "__main__":
    app.run(debug=True)