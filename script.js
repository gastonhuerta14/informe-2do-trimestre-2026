/* Dashboard Control de Gestion - Frontend
 * Vanilla JS + anime.js + Chart.js
 */
(function () {
    'use strict';

    const API_BASE = 'https://informe-cobranzas-165f.onrender.com/';
    const API_URL = API_BASE + '/api/data';

    const fmtARS = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });

    const fmtCompact = (val) => {
        const abs = Math.abs(val);
        const sign = val < 0 ? '-' : '';
        if (abs >= 1e9) return sign + '$ ' + (abs / 1e9).toFixed(2) + ' B';
        if (abs >= 1e6) return sign + '$ ' + (abs / 1e6).toFixed(1) + ' M';
        if (abs >= 1e3) return sign + '$ ' + (abs / 1e3).toFixed(0) + ' K';
        return fmtARS.format(val);
    };
    const formatCurrency = (val) => fmtARS.format(Math.round(val || 0));

    const CHEVRON_SVG = '<svg class="chev" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const CONCEPT_KEYS = {
        'FACTURACION INTERNACION': 'internacion',
        'FACTURACION AMBULATORIO': 'ambulatorio',
        'REFACTURACION': 'refacturacion',
        'CAMAS FIJAS': 'camasFijas',
        'NC EMITIDAS': 'nc',
    };

    const EXPANDABLE_CONCEPTS = new Set(Object.keys(CONCEPT_KEYS));
    const OSPG_CONCEPTS = new Set([
        'FACTURACION INTERNACION',
        'FACTURACION AMBULATORIO',
        'REFACTURACION',
        'CAMAS FIJAS',
    ]);

    let _dataCache = null;

    // ============== FETCH ==============
    async function loadData() {
        const res = await fetch(API_URL, { cache: 'no-store' });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error('Error API: ' + res.status + ' ' + txt);
        }
        return res.json();
    }

    // ============== KPIs ==============
    function computeKpis(data) {
        const stats = data.stats || [];
        const sum = (key) => stats.reduce((a, s) => a + (s[key] || 0), 0);
        const totalFacturado = sum('totalFacturado');
        const facturacionTotal = sum('facturacionTotal');
        const ncEmitidas = sum('nc');
        const top = (data.rankingGlobal || [])[0] || null;
        const ospgTri = (data.ospgTotals && data.ospgTotals.trimestre) || 0;
        return {
            totalFacturado,
            facturacionTotal,
            ncEmitidas,
            topClienteTotal: top ? top.total : 0,
            topClienteName: top ? top.cliente : '--',
            ospg: ospgTri,
        };
    }

    function renderKpiFronts(data, kpis) {
        const targets = {
            totalFacturado: kpis.totalFacturado,
            facturacionTotal: kpis.facturacionTotal,
            ncEmitidas: kpis.ncEmitidas,
            topCliente: kpis.topClienteTotal,
            ospg: kpis.ospg,
        };
        document.querySelectorAll('.flip-card').forEach((card) => {
            const k = card.getAttribute('data-kpi');
            const valEl = card.querySelector('.flip-front .kpi-value');
            valEl.setAttribute('data-target', targets[k] || 0);
            valEl.textContent = '$ 0';
        });

        const topNameEl = document.getElementById('topClienteName');
        if (topNameEl) topNameEl.textContent = kpis.topClienteName;

        const ncPct = kpis.facturacionTotal !== 0
            ? Math.abs(kpis.ncEmitidas / kpis.facturacionTotal) * 100
            : 0;
        const ncFoot = document.getElementById('ncImpactFoot');
        if (ncFoot) ncFoot.textContent = `Impacto: ${ncPct.toFixed(1)}% sobre bruta`;

        const ospgPct = kpis.facturacionTotal !== 0
            ? (kpis.ospg / kpis.facturacionTotal) * 100
            : 0;
        const ospgFoot = document.getElementById('ospgImpactFoot');
        if (ospgFoot) ospgFoot.textContent = `${ospgPct.toFixed(1)}% sobre facturacion externa`;

        renderSparkBars(data);
    }

    function renderSparkBars(data) {
        const stats = data.stats || [];
        const sparks = {
            totalFacturado: stats.map((s) => s.totalFacturado),
            facturacionTotal: stats.map((s) => s.facturacionTotal),
            nc: stats.map((s) => Math.abs(s.nc)),
            ospg: stats.map((s) => s.ospgTotal || 0),
        };
        document.querySelectorAll('.kpi-spark').forEach((el) => {
            const key = el.getAttribute('data-spark');
            const values = sparks[key];
            if (!values) return;
            const max = Math.max(...values, 1);
            el.innerHTML = '';
            const labels = ['E', 'F', 'M'];
            values.forEach((v, i) => {
                const bar = document.createElement('div');
                bar.className = 'spark-bar' + (key === 'nc' ? ' is-nc' : '');
                bar.setAttribute('data-pct', String((v / max) * 100));
                const lbl = document.createElement('span');
                lbl.className = 'spark-label';
                lbl.textContent = labels[i];
                bar.appendChild(lbl);
                el.appendChild(bar);
            });
        });
    }

    function renderKpiBacks(data, kpis) {
        const stats = data.stats || [];

        // 1) Total Facturado -> desglose mensual
        const tfBack = document.querySelector('[data-back="totalFacturado"]');
        if (tfBack) {
            const max = Math.max(...stats.map((s) => s.totalFacturado), 1);
            tfBack.innerHTML = stats.map((s) => {
                const pct = (s.totalFacturado / max) * 100;
                return `
                <div class="back-row">
                    <span class="back-key">${s.mes}</span>
                    <div class="back-bar"><div class="back-bar-fill" data-fill="${pct}"></div></div>
                    <span class="back-val">${formatCurrency(s.totalFacturado)}</span>
                </div>`;
            }).join('');
        }

        // 2) Facturacion Bruta -> mix por concepto (trimestre)
        const fbBack = document.querySelector('[data-back="facturacionTotal"]');
        if (fbBack) {
            const conceptos = [
                { lbl: 'Internacion', key: 'internacion' },
                { lbl: 'Ambulatorio', key: 'ambulatorio' },
                { lbl: 'Refacturacion', key: 'refacturacion' },
                { lbl: 'Camas Fijas', key: 'camasFijas' },
            ];
            const totals = conceptos.map((c) => ({
                ...c,
                val: stats.reduce((a, s) => a + (s[c.key] || 0), 0),
            }));
            const total = totals.reduce((a, c) => a + c.val, 0) || 1;
            fbBack.innerHTML = totals.map((c) => {
                const pct = (c.val / total) * 100;
                return `
                <div class="back-row">
                    <span class="back-key">${c.lbl} <strong>${pct.toFixed(1)}%</strong></span>
                    <div class="back-bar"><div class="back-bar-fill" data-fill="${pct}"></div></div>
                    <span class="back-val">${fmtCompact(c.val)}</span>
                </div>`;
            }).join('');
        }

        // 3) NC -> desglose mensual + impacto
        const ncBack = document.querySelector('[data-back="nc"]');
        if (ncBack) {
            const max = Math.max(...stats.map((s) => Math.abs(s.nc)), 1);
            const headerPct = kpis.facturacionTotal !== 0
                ? Math.abs(kpis.ncEmitidas / kpis.facturacionTotal) * 100
                : 0;
            ncBack.innerHTML = `
                <div class="back-row">
                    <span class="back-key">% sobre bruta</span>
                    <span class="back-val">${headerPct.toFixed(2)}%</span>
                </div>
            ` + stats.map((s) => {
                const pct = (Math.abs(s.nc) / max) * 100;
                return `
                <div class="back-row">
                    <span class="back-key">${s.mes}</span>
                    <div class="back-bar"><div class="back-bar-fill" data-fill="${pct}"></div></div>
                    <span class="back-val">${formatCurrency(s.nc)}</span>
                </div>`;
            }).join('');
        }

        // 4) Top Cliente -> podio top 3
        const tcBack = document.querySelector('[data-back="topCliente"]');
        if (tcBack) {
            const top3 = (data.rankingGlobal || []).slice(0, 3);
            const totalRank = (data.rankingGlobal || []).reduce((a, r) => a + r.total, 0) || 1;
            tcBack.innerHTML = `<div class="podio">` + top3.map((r, i) => {
                const pct = ((r.total / totalRank) * 100).toFixed(1);
                return `
                <div class="podio-item">
                    <span class="podio-rank">${i + 1}</span>
                    <span class="podio-name" title="${escapeHtml(r.cliente)}">${escapeHtml(r.cliente)}</span>
                    <span class="podio-val">${pct}%</span>
                </div>`;
            }).join('') + `</div>`;
        }

        // 5) OSPG -> desglose por concepto + mensual
        const ospgBack = document.querySelector('[data-back="ospg"]');
        if (ospgBack) {
            const totals = data.ospgTotals || { porConcepto: {}, porMes: {}, trimestre: 0 };
            const triTotal = totals.trimestre || 1;

            const concepts = [
                { lbl: 'Internacion', val: totals.porConcepto['FACTURACION INTERNACION'] || 0 },
                { lbl: 'Ambulatorio', val: totals.porConcepto['FACTURACION AMBULATORIO'] || 0 },
            ];
            const monthly = (data.stats || []).map((s) => ({
                lbl: s.mes,
                val: s.ospgTotal || 0,
            }));
            const maxM = Math.max(...monthly.map((m) => m.val), 1);

            ospgBack.innerHTML =
                concepts.map((c) => {
                    const pct = (c.val / triTotal) * 100;
                    return `
                    <div class="back-row">
                        <span class="back-key">${c.lbl} <strong>${pct.toFixed(1)}%</strong></span>
                        <div class="back-bar"><div class="back-bar-fill" data-fill="${pct}"></div></div>
                        <span class="back-val">${fmtCompact(c.val)}</span>
                    </div>`;
                }).join('') +
                monthly.map((m) => {
                    const pct = (m.val / maxM) * 100;
                    return `
                    <div class="back-row">
                        <span class="back-key">${m.lbl}</span>
                        <div class="back-bar"><div class="back-bar-fill" data-fill="${pct}"></div></div>
                        <span class="back-val">${fmtCompact(m.val)}</span>
                    </div>`;
                }).join('');
        }
    }

    function animateKpiEntry() {
        anime({
            targets: '.flip-card',
            translateY: [14, 0],
            opacity: [0, 1],
            duration: 650,
            delay: anime.stagger(110),
            easing: 'easeOutQuad',
        });
    }

    function animateKpiCounters() {
        document.querySelectorAll('.flip-front .kpi-value').forEach((el) => {
            const target = parseFloat(el.getAttribute('data-target')) || 0;
            const obj = { v: 0 };
            anime({
                targets: obj,
                v: target,
                round: 1,
                duration: 1600,
                easing: 'easeOutExpo',
                delay: 350,
                update: () => {
                    el.textContent = formatCurrency(obj.v);
                },
            });
        });
    }

    function animateSparks() {
        document.querySelectorAll('.kpi-spark .spark-bar').forEach((bar) => {
            const pct = parseFloat(bar.getAttribute('data-pct')) || 0;
            bar.style.height = '0%';
            anime({
                targets: bar,
                height: pct + '%',
                duration: 800,
                delay: 1100 + Math.random() * 250,
                easing: 'easeOutCubic',
            });
        });
    }

    // FLIP CARD INTERACTION
    function bindFlipCards() {
        document.querySelectorAll('.flip-card').forEach((card) => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('a, button')) return;
                const inner = card.querySelector('.flip-inner');
                const isFlipped = card.classList.toggle('is-flipped');
                anime.remove(inner);
                anime({
                    targets: inner,
                    rotateY: isFlipped ? 180 : 0,
                    duration: 750,
                    easing: 'easeInOutQuad',
                    complete: () => {
                        if (isFlipped) animateBackFills(card);
                    },
                });
            });
        });
    }

    function animateBackFills(card) {
        card.querySelectorAll('.back-bar-fill').forEach((el) => {
            const pct = parseFloat(el.getAttribute('data-fill')) || 0;
            el.style.width = '0%';
            anime({
                targets: el,
                width: pct + '%',
                duration: 700,
                easing: 'easeOutCubic',
                delay: anime.stagger(60),
            });
        });
    }

    // ============== MAIN TABLE ==============
    function buildMainTable(data) {
        const tbody = document.querySelector('#mainTable tbody');
        tbody.innerHTML = '';

        data.tablaPrincipal.forEach((row, idx) => {
            const isBruta = row.concepto === 'FACTURACION TOTAL';
            const isNeto = row.concepto === 'TOTAL FACTURADO';
            const isExpandable = EXPANDABLE_CONCEPTS.has(row.concepto);

            const tr = document.createElement('tr');
            tr.className = 'row-concepto'
                + (isBruta ? ' row-total' : '')
                + (isNeto ? ' row-total row-final' : '')
                + (isExpandable ? '' : ' no-expand');
            tr.setAttribute('data-concepto', row.concepto);
            tr.setAttribute('data-idx', String(idx));

            const negClass = (v) => (v < 0 ? ' row-negative' : '');
            tr.innerHTML = `
                <td><span class="cell-concepto">${CHEVRON_SVG}<span>${row.concepto}</span></span></td>
                <td class="text-end${negClass(row.enero)}">${formatCurrency(row.enero)}</td>
                <td class="text-end${negClass(row.febrero)}">${formatCurrency(row.febrero)}</td>
                <td class="text-end${negClass(row.marzo)}">${formatCurrency(row.marzo)}</td>
                <td class="text-end${negClass(row.trimestre)}"><strong>${formatCurrency(row.trimestre)}</strong></td>
            `;
            tbody.appendChild(tr);

            if (isExpandable) {
                const tdDetail = document.createElement('tr');
                tdDetail.className = 'row-detail';
                tdDetail.setAttribute('data-detail-for', row.concepto);
                tdDetail.innerHTML = `
                    <td colspan="5">
                        <div class="detail-wrap">
                            <div class="detail-inner"></div>
                        </div>
                    </td>
                `;
                tbody.appendChild(tdDetail);
            }
        });

        tbody.querySelectorAll('.row-concepto').forEach((tr) => {
            if (tr.classList.contains('no-expand')) return;
            tr.addEventListener('click', () => toggleDetail(tr, data));
        });

        // Entry animation
        anime({
            targets: '#mainTable tbody tr.row-concepto',
            opacity: [0, 1],
            translateY: [6, 0],
            duration: 400,
            delay: anime.stagger(55, { start: 250 }),
            easing: 'easeOutQuad',
        });

        animateTableNumbers();
    }

    function animateTableNumbers() {
        const cells = document.querySelectorAll(
            '#mainTable tbody tr.row-concepto td.text-end'
        );
        cells.forEach((td, i) => {
            const txt = td.textContent;
            const isStrong = !!td.querySelector('strong');
            const target = parseCurrency(txt);
            if (!Number.isFinite(target)) return;
            const obj = { v: 0 };
            anime({
                targets: obj,
                v: target,
                round: 1,
                duration: 1100,
                easing: 'easeOutExpo',
                delay: 400 + i * 12,
                update: () => {
                    td.innerHTML = isStrong
                        ? `<strong>${formatCurrency(obj.v)}</strong>`
                        : formatCurrency(obj.v);
                },
            });
        });
    }

    function parseCurrency(str) {
        if (!str) return NaN;
        const cleaned = String(str).replace(/[^0-9,\-]/g, '').replace(',', '.');
        const n = parseFloat(cleaned);
        return n;
    }

    function renderDetailContent(container, concepto, data) {
        const list = (data.desgloseMap && data.desgloseMap[concepto]) || [];
        const totalSum = list.reduce((a, b) => a + (b.total || 0), 0);
        const maxAbs = Math.max(...list.map((r) => Math.abs(r.total)), 1);

        const hasOspg = OSPG_CONCEPTS.has(concepto);
        const ospg = (data.ospgMap && data.ospgMap[concepto]) || null;

        const ospgHtml = hasOspg && ospg ? `
            <div class="ospg-banner" data-ospg>
                <span class="ospg-tag">Costos OSPG</span>
                <div class="ospg-cell"><span class="ospg-key">Enero</span><span class="ospg-val">${fmtCompact(ospg.enero || 0)}</span></div>
                <div class="ospg-cell"><span class="ospg-key">Febrero</span><span class="ospg-val">${fmtCompact(ospg.febrero || 0)}</span></div>
                <div class="ospg-cell"><span class="ospg-key">Marzo</span><span class="ospg-val">${fmtCompact(ospg.marzo || 0)}</span></div>
                <div class="ospg-cell"><span class="ospg-key">Trimestre</span><span class="ospg-val">${fmtCompact((ospg.enero||0)+(ospg.febrero||0)+(ospg.marzo||0))}</span></div>
            </div>
        ` : '';

        if (list.length === 0) {
            container.innerHTML = ospgHtml + `
                <div class="detail-title"><span>${concepto}</span><span class="detail-count">Sin clientes</span></div>
                <p class="text-muted small mb-0">Sin datos disponibles.</p>
            `;
            return;
        }

        const rowsHtml = list.map((r, i) => {
            const pct = totalSum !== 0 ? (r.total / totalSum) * 100 : 0;
            const barPct = (Math.abs(r.total) / maxAbs) * 100;
            const isNeg = r.total < 0;
            return `
                <div class="detail-row${isNeg ? ' neg' : ''}" data-bar="${barPct.toFixed(2)}">
                    <span class="rank-pill">${i + 1}</span>
                    <span class="det-name" title="${escapeHtml(r.cliente)}">${escapeHtml(r.cliente)}</span>
                    <span class="det-total">${formatCurrency(r.total)}</span>
                    <span class="det-pct">${pct.toFixed(1)}%</span>
                    <span class="det-bar"></span>
                </div>
            `;
        }).join('');

        container.innerHTML = ospgHtml + `
            <div class="detail-title">
                <span>${concepto} &middot; clientes</span>
                <span class="detail-count">${list.length} cliente${list.length === 1 ? '' : 's'} &middot; Total ${formatCurrency(totalSum)}</span>
            </div>
            <div class="detail-list">${rowsHtml}</div>
        `;
    }

    function animateDetailEntry(detailRow) {
        const banner = detailRow.querySelector('.ospg-banner');
        if (banner) {
            anime({
                targets: banner,
                opacity: [0, 1],
                translateY: [-4, 0],
                duration: 380,
                easing: 'easeOutQuad',
            });
        }
        const rows = detailRow.querySelectorAll('.detail-row');
        anime({
            targets: rows,
            opacity: [0, 1],
            translateX: [-6, 0],
            duration: 340,
            delay: anime.stagger(18, { start: 120 }),
            easing: 'easeOutQuad',
        });
        // animate proportional bars
        rows.forEach((rEl) => {
            const target = parseFloat(rEl.getAttribute('data-bar')) || 0;
            const bar = rEl.querySelector('.det-bar');
            if (!bar) return;
            bar.style.width = '0%';
            anime({
                targets: bar,
                width: target + '%',
                duration: 600,
                delay: 200,
                easing: 'easeOutCubic',
            });
        });
    }

    function toggleDetail(tr, data) {
        const concepto = tr.getAttribute('data-concepto');
        const detailRow = tr.parentElement.querySelector(
            `tr.row-detail[data-detail-for="${concepto}"]`
        );
        if (!detailRow) return;
        const wrap = detailRow.querySelector('.detail-wrap');
        const inner = detailRow.querySelector('.detail-inner');
        const isOpen = tr.classList.contains('is-open');

        if (isOpen) {
            const current = wrap.scrollHeight;
            anime.remove(wrap);
            wrap.style.height = current + 'px';
            anime({
                targets: wrap,
                height: [current, 0],
                opacity: [1, 0],
                duration: 320,
                easing: 'easeInOutQuad',
                complete: () => { wrap.style.height = '0px'; },
            });
            tr.classList.remove('is-open');
        } else {
            // Always re-render to ensure fresh state
            renderDetailContent(inner, concepto, data);

            anime.remove(wrap);
            wrap.style.height = 'auto';
            const fullHeight = wrap.scrollHeight;
            wrap.style.height = '0px';
            anime({
                targets: wrap,
                height: [0, fullHeight],
                opacity: [0, 1],
                duration: 420,
                easing: 'easeOutQuad',
                complete: () => {
                    wrap.style.height = 'auto';
                    animateDetailEntry(detailRow);
                },
            });
            tr.classList.add('is-open');
        }
    }

    // ============== RANKING ==============
    function buildRanking(data) {
        const list = document.getElementById('rankingList');
        list.innerHTML = '';
        const top = (data.rankingGlobal || []).slice(0, 20);
        const max = Math.max(...top.map((r) => r.total), 1);

        top.forEach((r, i) => {
            const pct = (r.total / max) * 100;
            const row = document.createElement('div');
            const medal = i === 0 ? ' gold' : i === 1 ? ' silver' : i === 2 ? ' bronze' : '';
            row.className = 'ranking-item' + medal;
            row.setAttribute('data-bar', pct.toFixed(2));
            row.innerHTML = `
                <span class="rk-pos">${i + 1}</span>
                <span class="rk-name" title="${escapeHtml(r.cliente)}">${escapeHtml(r.cliente)}</span>
                <span class="rk-total">${fmtCompact(r.total)}</span>
                <span class="rk-bar"></span>
            `;
            list.appendChild(row);
        });

        anime({
            targets: '.ranking-item',
            opacity: [0, 1],
            translateX: [-8, 0],
            delay: anime.stagger(35, { start: 250 }),
            duration: 420,
            easing: 'easeOutQuad',
        });

        // bars
        list.querySelectorAll('.ranking-item').forEach((el) => {
            const pct = parseFloat(el.getAttribute('data-bar')) || 0;
            const bar = el.querySelector('.rk-bar');
            bar.style.width = '0%';
            anime({
                targets: bar,
                width: pct + '%',
                duration: 800,
                easing: 'easeOutCubic',
                delay: anime.stagger(28, { start: 600 }),
            });
        });
    }

    // ============== CHART ==============
    let chartInstance = null;
    let currentChartView = 'mensual';

    const CHART_PALETTE = {
        dark: '#0f172a',
        slate: '#334155',
        accent: '#475569',
        muted: '#94a3b8',
        light: '#cbd5e1',
        danger: '#b91c1c',
        ospg: '#1e293b',
    };

    function getChartConfig(view, data) {
        const stats = data.stats || [];
        const labels = stats.map((s) => s.mes);

        if (view === 'ospg') {
            const externoInt = stats.map((s) => Math.round(s.internacion));
            const externoAmb = stats.map((s) => Math.round(s.ambulatorio));
            const ospgInt = stats.map((s) => Math.round(s.ospgInternacion || 0));
            const ospgAmb = stats.map((s) => Math.round(s.ospgAmbulatorio || 0));
            return {
                caption: 'Facturacion externa vs costos operativos OSPG por mes (Internacion + Ambulatorio)',
                labels,
                datasets: [
                    { label: 'Externo Internacion', data: externoInt, backgroundColor: CHART_PALETTE.dark, stack: 'externo', borderRadius: 4, maxBarThickness: 42 },
                    { label: 'Externo Ambulatorio', data: externoAmb, backgroundColor: CHART_PALETTE.accent, stack: 'externo', borderRadius: 4, maxBarThickness: 42 },
                    { label: 'OSPG Internacion', data: ospgInt, backgroundColor: CHART_PALETTE.slate, stack: 'ospg', borderRadius: 4, maxBarThickness: 42 },
                    { label: 'OSPG Ambulatorio', data: ospgAmb, backgroundColor: CHART_PALETTE.muted, stack: 'ospg', borderRadius: 4, maxBarThickness: 42 },
                ],
                stacked: true,
            };
        }

        if (view === 'conceptos') {
            const internacion = stats.map((s) => Math.round(s.internacion));
            const ambulatorio = stats.map((s) => Math.round(s.ambulatorio));
            const refacturacion = stats.map((s) => Math.round(s.refacturacion));
            const camasFijas = stats.map((s) => Math.round(s.camasFijas));
            return {
                caption: 'Apertura por concepto facturado, mes a mes',
                labels,
                datasets: [
                    { label: 'Internacion', data: internacion, backgroundColor: CHART_PALETTE.dark, borderRadius: 5, maxBarThickness: 36 },
                    { label: 'Ambulatorio', data: ambulatorio, backgroundColor: CHART_PALETTE.accent, borderRadius: 5, maxBarThickness: 36 },
                    { label: 'Refacturacion', data: refacturacion, backgroundColor: CHART_PALETTE.muted, borderRadius: 5, maxBarThickness: 36 },
                    { label: 'Camas Fijas', data: camasFijas, backgroundColor: CHART_PALETTE.light, borderRadius: 5, maxBarThickness: 36 },
                ],
                stacked: false,
            };
        }

        if (view === 'stacked') {
            const sumAll = (key) => stats.reduce((a, s) => a + (s[key] || 0), 0);
            const totales = [
                Math.round(sumAll('internacion')),
                Math.round(sumAll('ambulatorio')),
                Math.round(sumAll('refacturacion')),
                Math.round(sumAll('camasFijas')),
                Math.round(Math.abs(sumAll('nc'))),
            ];
            return {
                caption: 'Composicion del trimestre completo por concepto',
                labels: ['Internacion', 'Ambulatorio', 'Refacturacion', 'Camas Fijas', 'NC Emitidas'],
                datasets: [{
                    label: 'Total Trimestre',
                    data: totales,
                    backgroundColor: [
                        CHART_PALETTE.dark,
                        CHART_PALETTE.accent,
                        CHART_PALETTE.slate,
                        CHART_PALETTE.muted,
                        CHART_PALETTE.danger,
                    ],
                    borderRadius: 6,
                    maxBarThickness: 64,
                }],
                stacked: false,
            };
        }

        // default 'mensual'
        const bruta = stats.map((s) => Math.round(s.facturacionTotal));
        const neta = stats.map((s) => Math.round(s.totalFacturado));
        const ncs = stats.map((s) => Math.round(Math.abs(s.nc)));
        return {
            caption: 'Facturacion bruta vs neta y notas de credito por mes',
            labels,
            datasets: [
                { label: 'Facturacion Bruta', data: bruta, backgroundColor: CHART_PALETTE.dark, borderRadius: 5, maxBarThickness: 46 },
                { label: 'Total Facturado (Neto)', data: neta, backgroundColor: CHART_PALETTE.accent, borderRadius: 5, maxBarThickness: 46 },
                { label: 'NC Emitidas', data: ncs, backgroundColor: CHART_PALETTE.light, borderRadius: 5, maxBarThickness: 46 },
            ],
            stacked: false,
        };
    }

    function applyChartView(view, data) {
        currentChartView = view;
        const cfg = getChartConfig(view, data);

        const caption = document.getElementById('chartCaption');
        if (caption) caption.textContent = cfg.caption;

        if (!chartInstance) return;

        chartInstance.data.labels = cfg.labels;
        chartInstance.data.datasets = cfg.datasets;
        chartInstance.options.scales.x.stacked = !!cfg.stacked;
        chartInstance.options.scales.y.stacked = !!cfg.stacked;
        chartInstance.update('active');

        // Subtle pulse on the chart wrapper to confirm view change
        anime.remove('.chart-wrapper');
        anime({
            targets: '.chart-wrapper',
            opacity: [0.55, 1],
            scale: [0.985, 1],
            duration: 420,
            easing: 'easeOutQuad',
        });
    }

    function buildChart(data) {
        const ctx = document.getElementById('chartTrend');
        if (!ctx) return;
        const cfg = getChartConfig('mensual', data);

        const caption = document.getElementById('chartCaption');
        if (caption) caption.textContent = cfg.caption;

        if (chartInstance) chartInstance.destroy();

        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: cfg.labels, datasets: cfg.datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 1100, easing: 'easeOutQuart' },
                interaction: { mode: 'index', intersect: false },
                onClick: (evt, els) => {
                    if (!els || !els.length) return;
                    const el = els[0];
                    // Pulse the chart canvas to confirm interaction
                    anime.remove(ctx);
                    anime({
                        targets: ctx,
                        scale: [1, 1.015, 1],
                        duration: 360,
                        easing: 'easeOutQuad',
                    });
                    const ds = chartInstance.data.datasets[el.datasetIndex];
                    const lbl = chartInstance.data.labels[el.index];
                    const val = ds.data[el.index];
                    const cap = document.getElementById('chartCaption');
                    if (cap) cap.textContent = `${ds.label} - ${lbl}: ${formatCurrency(val)}`;
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#334155',
                            font: { size: 12, family: 'Inter' },
                            usePointStyle: true,
                            boxWidth: 8,
                            padding: 16,
                        },
                    },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        titleColor: '#ffffff',
                        bodyColor: '#e2e8f0',
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            label: (c) => c.dataset.label + ': ' + formatCurrency(c.parsed.y),
                        },
                    },
                },
                scales: {
                    x: {
                        stacked: !!cfg.stacked,
                        grid: { display: false },
                        ticks: { color: '#64748b', font: { family: 'Inter', weight: '600' } },
                    },
                    y: {
                        stacked: !!cfg.stacked,
                        beginAtZero: true,
                        grid: { color: '#e2e8f0', drawBorder: false },
                        ticks: {
                            color: '#64748b',
                            font: { family: 'Inter' },
                            callback: (v) => fmtCompact(v),
                        },
                    },
                },
            },
        });
    }

    function bindChartSwitch(data) {
        const wrap = document.getElementById('chartSwitch');
        if (!wrap) return;
        wrap.querySelectorAll('.chart-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-view');
                if (!view || view === currentChartView) return;
                wrap.querySelectorAll('.chart-tab').forEach((b) => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                applyChartView(view, data);
            });
        });
    }

    // ============== UTILS ==============
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function hideLoader() {
        const loader = document.getElementById('loader');
        if (loader) loader.classList.add('hidden');
    }

    function showError(message) {
        const loader = document.getElementById('loader');
        if (loader) {
            loader.innerHTML = `
                <div style="max-width:520px;text-align:center;padding:1.6rem;background:#fff;border:1px solid var(--corp-border);border-radius:14px;">
                    <h3 style="color:#b91c1c;margin:0 0 .5rem;font-size:1.1rem;">No se pudieron cargar los datos</h3>
                    <p style="color:var(--corp-muted);font-size:.85rem;margin:0;">${escapeHtml(message)}</p>
                </div>
            `;
        }
    }

    function setUpdateTimestamp() {
        const el = document.getElementById('lastUpdate');
        if (!el) return;
        const now = new Date();
        const opts = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
        el.textContent = 'Actualizado: ' + now.toLocaleString('es-AR', opts);
    }

    // ============== INIT ==============
    async function init() {
        try {
            const data = await loadData();
            _dataCache = data;
            const kpis = computeKpis(data);

            renderKpiFronts(data, kpis);
            renderKpiBacks(data, kpis);
            buildMainTable(data);
            buildRanking(data);
            buildChart(data);
            bindChartSwitch(data);
            setUpdateTimestamp();
            hideLoader();

            animateKpiEntry();
            animateKpiCounters();
            animateSparks();
            bindFlipCards();
        } catch (err) {
            console.error(err);
            showError(err.message || 'Error desconocido');
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
