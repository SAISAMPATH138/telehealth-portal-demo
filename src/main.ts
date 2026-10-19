import './styles.css';
import { createStore } from './store';
import { navigateBook, renderBook, resetDraft } from './ui/book';
import { renderHome, renderVisits } from './ui/home';
import { renderRecords } from './ui/records';
import { leaveRoom, renderRoom } from './ui/room';

const app = document.getElementById('app')!;
const store = createStore();
const navigate = (href: string) => (location.hash = href);

let current = '';

function route() {
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page = 'home', arg] = path.split('/');
  if (page !== 'room') leaveRoom();
  if (page !== current || page === 'book') window.scrollTo({ top: 0 });
  if (page === 'book' && current !== 'book') resetDraft();
  current = page;

  for (const a of document.querySelectorAll<HTMLAnchorElement>('.nav a')) {
    a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${page}`);
  }
  document.body.classList.toggle('in-room', page === 'room');

  switch (page) {
    case 'book':
      navigateBook(store, new URLSearchParams(qs));
      return renderBook(app, store, navigate);
    case 'records':
      return renderRecords(app);
    case 'visits':
      return renderVisits(app, store);
    case 'room':
      return renderRoom(app, store, arg ?? '');
    default:
      return renderHome(app, store);
  }
}

// Re-render pages that list visits when bookings change; flows manage their own redraws.
store.subscribe(() => {
  if (current === 'home' || current === 'visits') route();
});

// Keep "in 12 min" labels and the join button current.
setInterval(() => {
  if (current === 'home') route();
}, 30_000);

document.getElementById('reset-demo')!.addEventListener('click', () => {
  store.reset();
  navigate('#/home');
  route();
});

window.addEventListener('hashchange', route);
route();
