(() => {

const cards = [...document.querySelectorAll('.card')];
const groups = [...document.querySelectorAll('.group')];
const search = document.querySelector('#search');
const select = document.querySelector('#group');
const texts = new Map(cards.map(card => [card, card.textContent.normalize('NFKC').toLowerCase()]));
function filter() {
  const terms = search.value.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  for (const card of cards) {
    card.hidden = (select.value && card.closest('.group').dataset.group !== select.value) || !terms.every(term => texts.get(card).includes(term));
    if (terms.length && !card.hidden) card.open = true;
  }
  for (const group of groups) group.hidden = ![...group.querySelectorAll('.card')].some(card => !card.hidden);
  const count = cards.filter(card => !card.hidden).length;
  document.querySelector('#result').textContent = `${count} of ${cards.length} cards`;
  document.querySelector('#empty').hidden = count !== 0;
}
search.addEventListener('input', filter); select.addEventListener('change', filter);
document.querySelector('#expand').onclick = () => cards.filter(c => !c.hidden).forEach(c => c.open = true);
document.querySelector('#collapse').onclick = () => cards.filter(c => !c.hidden).forEach(c => c.open = false);
document.querySelector('#reset').onclick = () => { search.value = ''; select.value = ''; filter(); };
let printState;
window.addEventListener('beforeprint', () => { printState = cards.map(c => c.open); cards.filter(c => !c.hidden).forEach(c => c.open = true); });
window.addEventListener('afterprint', () => { if (printState) cards.forEach((c,i) => c.open = printState[i]); });
document.querySelector('#print').onclick = () => window.print();
function revealHash() {
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (!target || (!target.classList.contains('card') && !target.classList.contains('group'))) return;
  search.value = ''; select.value = ''; filter();
  if (target.classList.contains('card')) target.open = true;
  requestAnimationFrame(() => target.scrollIntoView());
}
window.addEventListener('hashchange', revealHash); revealHash();

const popup = document.getElementById('word-popup');
const jisho = document.getElementById('word-jisho');
let activeWord = null;
let dismissTimer;
function closeReading() {
  clearTimeout(dismissTimer);
  popup.hidden = true;
  if (activeWord) activeWord.setAttribute('aria-expanded', 'false');
  activeWord = null;
}
function showReading(word) {
  clearTimeout(dismissTimer);
  if (activeWord && activeWord !== word) activeWord.setAttribute('aria-expanded', 'false');
  activeWord = word;
  document.getElementById('word-romaji').textContent = word.dataset.romaji;
  document.getElementById('word-kana').textContent = word.dataset.kana;
  jisho.href = 'https://jisho.org/search/' + encodeURIComponent(word.dataset.lemma);
  word.setAttribute('aria-expanded', 'true');
  popup.hidden = false;
  const anchor = word.getBoundingClientRect();
  const box = popup.getBoundingClientRect();
  popup.style.left = Math.max(10, Math.min(anchor.left, innerWidth - box.width - 10)) + 'px';
  const below = anchor.bottom + 6;
  popup.style.top = (below + box.height <= innerHeight - 10 ? below : Math.max(10, anchor.top - box.height - 6)) + 'px';
}
// The short delay lets the pointer cross the gap to the clickable dictionary link.
function scheduleDismiss() {
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    if (!popup.contains(document.activeElement) && document.activeElement !== activeWord) closeReading();
  }, 220);
}
document.addEventListener('pointerover', event => {
  if (event.pointerType !== 'mouse') return;
  const word = event.target.closest('.word');
  if (word) showReading(word);
  else if (popup.contains(event.target)) clearTimeout(dismissTimer);
});
document.addEventListener('pointerout', event => {
  if (event.pointerType === 'mouse' && (event.target.closest('.word') || popup.contains(event.target))) scheduleDismiss();
});
document.addEventListener('focusin', event => {
  const word = event.target.closest('.word');
  if (word) showReading(word);
  else if (!popup.contains(event.target)) closeReading();
});
document.addEventListener('click', event => {
  const word = event.target.closest('.word');
  if (word) {
    showReading(word);
    if (event.detail === 0) jisho.focus();
  } else if (!popup.contains(event.target)) closeReading();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeWord) {
    const word = activeWord;
    if (popup.contains(document.activeElement)) word.focus();
    closeReading();
    event.preventDefault();
  }
});
window.addEventListener('scroll', closeReading, {passive: true});
window.addEventListener('resize', closeReading);
window.addEventListener('beforeprint', closeReading);
search.addEventListener('input', closeReading);
select.addEventListener('change', closeReading);

})();
