// 요소 생성 도우미. 외부 데이터는 항상 textContent로 넣는다.
export function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
