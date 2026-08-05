/**
 * Renders prev/next pagination into a container.
 * @param {HTMLElement} container
 * @param {{ page: number, totalPages: number, total: number }} pagination
 * @param {(page: number) => void} onPageChange
 */
import { icon } from '/js/icons.js';

export function renderPagination(container, pagination, onPageChange) {
  const { page, totalPages } = pagination;
  container.innerHTML = '';

  if (totalPages <= 1) return;

  const prev = document.createElement('button');
  prev.className = 'btn btn-outline btn-sm';
  prev.innerHTML = `${icon('chevron-left', 15)}<span>Prev</span>`;
  prev.disabled = page <= 1;
  prev.addEventListener('click', () => onPageChange(page - 1));

  const info = document.createElement('span');
  info.className = 'pagination-info';
  info.textContent = `Page ${page} of ${totalPages}`;

  const next = document.createElement('button');
  next.className = 'btn btn-outline btn-sm';
  next.innerHTML = `<span>Next</span>${icon('chevron-right', 15)}`;
  next.disabled = page >= totalPages;
  next.addEventListener('click', () => onPageChange(page + 1));

  container.append(prev, info, next);
}
