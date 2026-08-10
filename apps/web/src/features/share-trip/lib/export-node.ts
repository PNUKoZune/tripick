import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

async function renderPng(node: HTMLElement): Promise<{ dataUrl: string; width: number; height: number }> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: '#ffffff',
  });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { dataUrl, width: img.width, height: img.height };
}

/** DOM 노드를 PNG 이미지로 저장 */
export async function downloadNodeAsPng(node: HTMLElement, filename: string): Promise<void> {
  const { dataUrl } = await renderPng(node);
  triggerDownload(dataUrl, filename);
}

/** DOM 노드를 단일 페이지 PDF 로 저장 (카드 비율에 맞춘 한 장) */
export async function downloadNodeAsPdf(node: HTMLElement, filename: string): Promise<void> {
  const { dataUrl, width, height } = await renderPng(node);
  const pdf = new jsPDF({
    orientation: width > height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [width, height],
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
  pdf.save(filename);
}

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
