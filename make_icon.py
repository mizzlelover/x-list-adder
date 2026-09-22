#!/usr/bin/env python3
"""生成 X List Adder 扩展图标：蓝色渐变圆角方块 + 列表线 + 加号徽章"""
from PIL import Image, ImageDraw

S = 4  # 4x 超采样抗锯齿

def make(size):
    W = size * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # --- 圆角方形渐变底 ---
    radius = int(W * 0.24)
    grad = Image.new('RGBA', (W, W))
    gd = ImageDraw.Draw(grad)
    top = (42, 168, 244)    # #2aa8f4
    bottom = (24, 119, 200) # 深一点的蓝
    for y in range(W):
        t = y / W
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        gd.line([(0, y), (W, y)], fill=c + (255,))
    mask = Image.new('L', (W, W), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, W - 1, W - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # --- 列表线（左对齐，三条，第三条较短） ---
    white = (255, 255, 255, 255)
    x0, x1 = W * 0.20, W * 0.68
    bar_h = W * 0.075
    ys = [W * 0.26, W * 0.44, W * 0.62]
    ends = [x1, x1, W * 0.50]
    for y, xe in zip(ys, ends):
        d.rounded_rectangle([x0, y, xe, y + bar_h], radius=bar_h / 2, fill=white)

    # --- 加号徽章（右下角白圆 + 蓝加号） ---
    br = W * 0.20                       # 徽章半径
    cx, cy = W * 0.72, W * 0.70         # 圆心
    # 徽章描边一圈底色，显得有层次
    d.ellipse([cx - br, cy - br, cx + br, cy + br], fill=white)
    plus_w = W * 0.045
    pl = br * 0.52                      # 加号臂长
    blue = (29, 155, 240, 255)
    d.rounded_rectangle([cx - pl, cy - plus_w, cx + pl, cy + plus_w],
                        radius=plus_w, fill=blue)
    d.rounded_rectangle([cx - plus_w, cy - pl, cx + plus_w, cy + pl],
                        radius=plus_w, fill=blue)

    return img.resize((size, size), Image.LANCZOS)

for s in (16, 48, 128):
    make(s).save(f'/Users/a1-6/Documents/Codex/x-list-adder/icon{s}.png')
    print(f'icon{s}.png done')
