// Общее для e2e-ботов мини-игр партии b3 (T-140): в странице — window.__ptr(type, x, y) шлёт настоящий PointerEvent по холсту
// игры в координатах поля (x, y — единицы поля spec.W × spec.H). Не игра: arcade-test берёт только js/games/arcade/<id>.js.
exports.PTR = id => `window.__ptr = (type, x, y) => {
  const sp = GAME_IMPL.${id}._test.spec, cv = document.querySelector('.ak-cv'); if (!cv) return;
  const r = cv.getBoundingClientRect();
  cv.dispatchEvent(new PointerEvent(type, { clientX: r.left + x * r.width / sp.W, clientY: r.top + y * r.height / sp.H,
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 }));
}`;
