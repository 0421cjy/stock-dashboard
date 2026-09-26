import { parseAmount } from './calc.js';

const $ = (id) => document.getElementById(id);

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

// 저장 버튼이면 onSubmit을 기다리고, 실패하면 대화상자 안에 오류를 보여준다.
function bindSubmit(form, dialog, saveBtn, errorEl, collect) {
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== 'save') return; // 취소는 기본 동작(닫기)
    e.preventDefault();
    const result = collect();
    if (result.error) {
      showError(errorEl, result.error);
      return;
    }
    saveBtn.disabled = true;
    try {
      await result.submit();
      dialog.close();
    } catch (err) {
      showError(errorEl, err.message);
    } finally {
      saveBtn.disabled = false;
    }
  };
}

export function openHoldingDialog({ mode, holding = null, onSubmit }) {
  const dialog = $('holding-dialog');
  const symbol = $('h-symbol');
  const shares = $('h-shares');
  const avgCost = $('h-avgcost');
  const errorEl = $('holding-error');

  $('holding-title').textContent = mode === 'edit' ? `${holding.symbol} 수정` : '종목 추가';
  symbol.value = holding?.symbol ?? '';
  symbol.disabled = mode === 'edit';
  shares.value = holding?.shares ?? '';
  avgCost.value = holding?.avgCost ?? '';
  errorEl.hidden = true;

  bindSubmit($('holding-form'), dialog, $('holding-save'), errorEl, () => {
    const values = {
      symbol: symbol.value.trim(),
      shares: parseAmount(shares.value),
      avgCost: parseAmount(avgCost.value),
    };
    if (!values.symbol) return { error: '티커를 입력해주세요.' };
    if (!(values.shares > 0) || !(values.avgCost > 0)) {
      return { error: '수량과 평단가는 0보다 큰 숫자로 입력해주세요. (예: 1,000 또는 14.20)' };
    }
    return { submit: () => onSubmit(values) };
  });

  dialog.showModal();
  (mode === 'edit' ? shares : symbol).focus();
}

export function openEventDialog({ event = null, onSubmit, onDelete }) {
  const dialog = $('event-dialog');
  const title = $('ev-title');
  const date = $('ev-date');
  const note = $('ev-note');
  const errorEl = $('event-error');
  const del = $('event-delete');

  $('event-title').textContent = event ? '일정 수정' : '일정 추가';
  title.value = event?.title ?? '';
  date.value = event?.date ?? '';
  note.value = event?.note ?? '';
  errorEl.hidden = true;
  del.hidden = !event;
  del.onclick = async () => {
    dialog.close();
    await onDelete?.();
  };

  bindSubmit($('event-form'), dialog, $('event-save'), errorEl, () => {
    const values = { title: title.value.trim(), date: date.value, note: note.value.trim() };
    if (!values.title) return { error: '제목을 입력해주세요.' };
    if (!values.date) return { error: '날짜를 골라주세요.' };
    return { submit: () => onSubmit(values) };
  });

  dialog.showModal();
  title.focus();
}

// 결과는 버튼 제출(submit)과 Esc(cancel)로 받는다. close 이벤트는 화면이 그려지지 않는
// 창(숨겨진 탭 등)에서 늦거나 오지 않을 수 있어서 쓰지 않는다.
export function confirmDialog(message) {
  const dialog = $('confirm-dialog');
  const form = dialog.querySelector('form');
  $('confirm-message').textContent = message;
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = (ok) => {
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onCancel);
      resolve(ok);
    };
    const onSubmit = (e) => finish(e.submitter?.value === 'ok');
    const onCancel = () => finish(false);
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);
  });
}
