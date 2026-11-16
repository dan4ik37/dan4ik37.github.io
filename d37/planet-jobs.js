// Terrain opens the scene. Once it is visible, give vegetation a regular turn
// even when the terrain queue never empties during flight.
export function planetJobs(app, pool) {
  let rows;
  let chunkDispatches = 0;

  function scatter(idle, offset, max) {
    if (max <= 0) return 0;
    rows ??= Array.from(app.scatter_rows());
    if (!rows.length) return 0;
    const jobs = app.take_scatter_jobs(max);
    const count = jobs.length / 5;
    for (let i = 0; i < count; i++) {
      const slot = idle[offset + i];
      slot.busy = true;
      slot.scatter = true;
      slot.w.postMessage({ type: 'scatter', w: Array.from(jobs.subarray(i * 5, i * 5 + 5)), rows });
    }
    if (count > 0) chunkDispatches = 0;
    return count;
  }

  return (idle, loaded) => {
    if (!idle.length) return;
    let room = loaded
      ? Math.max(1, pool.length >> 1) - pool.filter(slot => slot.busy && slot.scatter && !slot.dead).length
      : 0;
    const reserve = idle.length > 1 ? idle.length - 1 : Number(chunkDispatches >= 3);
    const first = scatter(idle, 0, Math.min(reserve, room));
    room -= first;

    const jobs = app.take_chunk_jobs(idle.length - first);
    const count = jobs.length / 2;
    for (let i = 0; i < count; i++) {
      const slot = idle[first + i];
      slot.busy = true;
      slot.w.postMessage({ type: 'chunk', lo: jobs[i * 2], hi: jobs[i * 2 + 1] });
    }
    chunkDispatches = Math.min(3, chunkDispatches + count);
    scatter(idle, first + count, Math.min(idle.length - first - count, room));
  };
}
