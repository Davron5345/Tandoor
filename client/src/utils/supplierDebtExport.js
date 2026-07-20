/** Экспорт отчёта «Долги поставщикам» в JPEG / PDF (canvas, без внешних библиотек). */

function formatNum(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(n) || 0);
}

function formatPeriod(dateFrom, dateTo) {
  const fmt = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  };
  if (dateFrom && dateTo && dateFrom === dateTo) return fmt(dateFrom);
  if (dateFrom && dateTo) return `${fmt(dateFrom)} — ${fmt(dateTo)}`;
  return fmt(dateFrom || dateTo) || '';
}

function measureText(ctx, text, font) {
  ctx.font = font;
  return ctx.measureText(String(text ?? '')).width;
}

function wrapText(ctx, text, maxWidth, font) {
  ctx.font = font;
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * @param {{
 *   branchName: string,
 *   dateFrom: string,
 *   dateTo: string,
 *   rows: Array<{ name: string, opening_debt: number, prihod: number, payment: number, closing_debt: number }>,
 *   totals: { opening_debt: number, prihod: number, payment: number, closing_debt: number },
 * }} options
 * @returns {HTMLCanvasElement}
 */
export function renderSupplierDebtReportCanvas({
  branchName,
  dateFrom,
  dateTo,
  rows,
  totals,
}) {
  const scale = 2;
  const padding = 28;
  const headerH = 56;
  const colHeaderH = 40;
  const rowH = 36;
  const totalH = 42;
  const gap = 0;

  const headers = ['Поставщик', 'Долг на начало', 'Приход', 'Оплата', 'Долг на конец'];
  const bodyFont = '500 15px "Segoe UI", system-ui, sans-serif';
  const headerFont = '700 14px "Segoe UI", system-ui, sans-serif';
  const titleFont = '800 28px "Segoe UI", system-ui, sans-serif';
  const periodFont = '500 14px "Segoe UI", system-ui, sans-serif';

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');

  const nameColMin = 220;
  const numColMin = 130;
  let nameColW = nameColMin;
  for (const row of rows) {
    nameColW = Math.max(nameColW, measureText(mctx, row.name, bodyFont) + 24);
  }
  nameColW = Math.max(nameColW, measureText(mctx, 'Итого', '700 15px "Segoe UI", system-ui, sans-serif') + 24);
  nameColW = Math.min(nameColW, 360);

  const colWidths = [nameColW, numColMin, numColMin, numColMin, numColMin];
  const tableW = colWidths.reduce((s, w) => s + w, 0);
  const width = tableW + padding * 2;
  const height = padding
    + headerH
    + 28
    + colHeaderH
    + rows.length * rowH
    + (rows.length ? totalH : rowH)
    + padding;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Title bar (like spreadsheet yellow header)
  const titleY = padding;
  drawRoundedRect(ctx, padding, titleY, tableW, headerH, 8);
  ctx.fillStyle = '#f6d860';
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.font = titleFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(branchName || 'Отчёт').toUpperCase(), padding + tableW / 2, titleY + headerH / 2);

  // Period
  const periodY = titleY + headerH + 18;
  ctx.font = periodFont;
  ctx.fillStyle = '#555';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Период: ${formatPeriod(dateFrom, dateTo)}`, padding, periodY);

  let y = periodY + 14;

  const drawRowBg = (x, rowY, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, rowY, tableW, h);
  };

  const drawCellBorders = (rowY, h) => {
    ctx.strokeStyle = '#c9b458';
    ctx.lineWidth = 1;
    let x = padding;
    for (const w of colWidths) {
      ctx.strokeRect(x + 0.5, rowY + 0.5, w - 1, h - 1);
      x += w;
    }
  };

  // Column headers
  drawRowBg(padding, y, colHeaderH, '#f6d860');
  drawCellBorders(y, colHeaderH);
  ctx.font = headerFont;
  ctx.fillStyle = '#1a1a1a';
  ctx.textBaseline = 'middle';
  {
    let x = padding;
    headers.forEach((label, i) => {
      const w = colWidths[i];
      if (i === 0) {
        ctx.textAlign = 'left';
        ctx.fillText(label, x + 12, y + colHeaderH / 2);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(label, x + w - 12, y + colHeaderH / 2);
      }
      x += w;
    });
  }
  y += colHeaderH + gap;

  const paintDataRow = (values, bg, bold = false) => {
    drawRowBg(padding, y, rowH, bg);
    drawCellBorders(y, rowH);
    ctx.font = bold ? '700 15px "Segoe UI", system-ui, sans-serif' : bodyFont;
    ctx.fillStyle = '#1a1a1a';
    ctx.textBaseline = 'middle';
    let x = padding;
    values.forEach((value, i) => {
      const w = colWidths[i];
      if (i === 0) {
        ctx.textAlign = 'left';
        const lines = wrapText(ctx, value, w - 20, ctx.font);
        const lineH = 16;
        const startY = y + rowH / 2 - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, li) => {
          ctx.fillText(line, x + 12, startY + li * lineH);
        });
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(formatNum(value), x + w - 12, y + rowH / 2);
      }
      x += w;
    });
    y += rowH + gap;
  };

  if (rows.length === 0) {
    drawRowBg(padding, y, rowH, '#fffef5');
    drawCellBorders(y, rowH);
    ctx.font = bodyFont;
    ctx.fillStyle = '#777';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Нет данных за выбранный период', padding + tableW / 2, y + rowH / 2);
    y += rowH;
  } else {
    rows.forEach((row, idx) => {
      paintDataRow(
        [row.name, row.opening_debt, row.prihod, row.payment, row.closing_debt],
        idx % 2 === 0 ? '#ffffff' : '#fff8dc',
      );
    });

    // Totals (pink like example)
    const th = totalH;
    drawRowBg(padding, y, th, '#f4b6c2');
    drawCellBorders(y, th);
    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.textBaseline = 'middle';
    const totalValues = [
      'ИТОГО',
      totals.opening_debt,
      totals.prihod,
      totals.payment,
      totals.closing_debt,
    ];
    let x = padding;
    totalValues.forEach((value, i) => {
      const w = colWidths[i];
      if (i === 0) {
        ctx.textAlign = 'left';
        ctx.fillText(String(value), x + 12, y + th / 2);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(formatNum(value), x + w - 12, y + th / 2);
      }
      x += w;
    });
  }

  return canvas;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function canvasToJpegBlob(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Не удалось создать JPEG'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

/** Minimal single-page PDF with embedded JPEG (points ≈ CSS px). */
async function jpegBlobToPdfBlob(jpegBlob, widthPx, heightPx) {
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  // Fit on A4 landscape or portrait depending on aspect
  const pageW = widthPx;
  const pageH = heightPx;

  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0];

  const push = (chunk) => {
    if (typeof chunk === 'string') parts.push(encoder.encode(chunk));
    else parts.push(chunk);
  };

  const addObj = (index, body, streamBytes = null) => {
    offsets[index] = parts.reduce((s, p) => s + p.length, 0);
    push(`${index} 0 obj\n`);
    push(body);
    if (streamBytes) {
      push('stream\n');
      push(streamBytes);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  push('%PDF-1.4\n');

  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>\n');
  addObj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');
  addObj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] `
    + `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\n`,
  );

  const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  addObj(4, `<< /Length ${encoder.encode(content).length} >>\n`, encoder.encode(content));

  offsets[5] = parts.reduce((s, p) => s + p.length, 0);
  push('5 0 obj\n');
  push(
    `<< /Type /XObject /Subtype /Image /Width ${Math.round(widthPx)} /Height ${Math.round(heightPx)} `
    + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\n`,
  );
  push('stream\n');
  push(jpegBytes);
  push('\nendstream\nendobj\n');

  const xrefStart = parts.reduce((s, p) => s + p.length, 0);
  const objCount = 6;
  push(`xref\n0 ${objCount}\n`);
  push('0000000000 65535 f \n');
  for (let i = 1; i < objCount; i += 1) {
    push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objCount} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return new Blob([out], { type: 'application/pdf' });
}

function buildFilename(branchName, dateFrom, dateTo, ext) {
  const safeBranch = String(branchName || 'report')
    .replace(/[^\w\u0400-\u04FF-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40);
  const period = formatPeriod(dateFrom, dateTo).replace(/\s+/g, '').replace(/—/g, '-');
  return `dolgi_postavshikam_${safeBranch}_${period || 'period'}.${ext}`;
}

/**
 * @param {{
 *   branchName: string,
 *   dateFrom: string,
 *   dateTo: string,
 *   rows: Array<object>,
 *   totals: object,
 *   format: 'jpeg' | 'pdf',
 * }} options
 */
export async function downloadSupplierDebtReport(options) {
  const { format = 'jpeg', ...rest } = options;
  const canvas = renderSupplierDebtReportCanvas(rest);
  const jpegBlob = await canvasToJpegBlob(canvas);
  // CSS pixel size (before device scale)
  const widthPx = canvas.width / 2;
  const heightPx = canvas.height / 2;

  if (format === 'pdf') {
    const pdfBlob = await jpegBlobToPdfBlob(jpegBlob, widthPx, heightPx);
    triggerDownload(pdfBlob, buildFilename(rest.branchName, rest.dateFrom, rest.dateTo, 'pdf'));
    return;
  }

  triggerDownload(jpegBlob, buildFilename(rest.branchName, rest.dateFrom, rest.dateTo, 'jpg'));
}
