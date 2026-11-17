// Terrain opens the scene. Once it is visible, give vegetation a regular turn
// even when the terrain queue never empties during flight.
export function terrainWorkerCount(cores, touch, separateWorld, configured = 4) {
  // Leave room for rendering and, when active, the simulation thread.
  const available = Math.max(1, cores - (separateWorld ? 2 : 1));
  return Math.max(0, Math.min(configured, touch ? 2 : 4, available));
}

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
    app.set_dig_background?.(pool.some(slot => slot.ready && !slot.dead));
    if (!idle.length) return;
    // Independent cave bricks can be meshed together. Reserve a lane for surface chunks
    // while other terrain workers keep streaming the visible world.
    const caveLimit = Math.max(1, pool.filter(slot => slot.ready && !slot.dead).length >> 1);
    let caves = loaded ? caveLimit - pool.filter(slot => slot.digTicket !== undefined && !slot.dead).length : 0;
    let assigned = 0;
    const available = Math.max(1, idle.length - 1);
    while (caves > 0 && assigned < available) {
      const job = app.take_dig_job?.();
      if (!job?.length) break;
      const slot = idle[assigned++];
      slot.digTicket = new DataView(job.buffer, job.byteOffset, job.byteLength).getUint32(0, true);
      slot.busy = true;
      slot.w.postMessage({ type: 'dig', ticket: slot.digTicket, bytes: job.buffer }, [job.buffer]);
      caves--;
    }
    idle = idle.slice(assigned);
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

export function finishDigJob(app, slot, message) {
  const ticket = slot.digTicket;
  if (ticket === undefined || (message && message.ticket !== ticket)) return;
  slot.digTicket = undefined;
  slot.busy = false;
  if (!message?.bytes) slot.dead = true;
  app.push_dig_result(ticket, message?.bytes ? new Uint8Array(message.bytes) : new Uint8Array(0));
}
