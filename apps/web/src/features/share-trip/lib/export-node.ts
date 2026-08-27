import { saveDataUrl } from './save-file';

/**
 * html-to-image(약 190KB) · jspdf(약 610KB + canvg 약 150KB)는 "이미지/PDF 로 저장"을
 * 실제로 누를 때만 필요한데, 정적 import 면 공유 시트를 품은 planner 첫 로드에 통째로
 * 실린다. 호출 시점에 동적으로 받아 초기 번들에서 빼둔다.
 */
async function renderPng(
  node: HTMLElement,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { toPng } = await import('html-to-image');
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
  await saveDataUrl(dataUrl, filename, 'image/png');
}

/** DOM 노드를 단일 페이지 PDF 로 저장 (카드 비율에 맞춘 한 장) */
export async function downloadNodeAsPdf(node: HTMLElement, filename: string): Promise<void> {
  const { dataUrl, width, height } = await renderPng(node);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation: width > height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [width, height],
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
  // jsPDF 의 save() 도 결국 <a download> 라 앱 웹뷰에선 버려진다 — dataURL 로 뽑아 같은 경로로 보낸다.
  await saveDataUrl(pdf.output('datauristring'), filename, 'application/pdf');
}
