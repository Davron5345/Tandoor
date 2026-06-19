import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { DOC_TYPE_LABELS } from '../permissions';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const TYPE_COLORS = {
  prihod: 'var(--prihod)',
  rashod: 'var(--rashod)',
  peremeshchenie: 'var(--primary)',
  razdelka: '#8b5cf6',
};

const STATUS_COLORS = {
  confirmed: 'var(--success)',
  draft: 'var(--warning)',
  cancelled: 'var(--danger)',
};

const STATUS_LABELS = {
  confirmed: 'Проведён',
  draft: 'Черновик',
  cancelled: 'Отменён',
};

function buildMonthlySeries(monthlyActivity) {
  const map = Object.fromEntries((monthlyActivity || []).map((r) => [r.month, r]));
  const result = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = map[key];
    result.push({
      month: key,
      label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      count: row?.count || 0,
      total: row?.total || 0,
    });
  }
  return result;
}

function DonutChart({ segments, emptyLabel }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return <div className="dash-chart-empty">{emptyLabel}</div>;
  }

  let angle = 0;
  const stops = segments
    .filter((s) => s.value > 0)
    .map((seg) => {
      const pct = (seg.value / total) * 100;
      const start = angle;
      angle += pct;
      return `${seg.color} ${start}% ${angle}%`;
    });

  return (
    <div className="dash-donut-wrap">
      <div
        className="dash-donut"
        style={{ background: `conic-gradient(${stops.join(', ')})` }}
      >
        <div className="dash-donut-hole">
          <strong>{total}</strong>
          <span>док.</span>
        </div>
      </div>
      <ul className="dash-legend">
        {segments.filter((s) => s.value > 0).map((seg) => (
          <li key={seg.key}>
            <span className="dash-legend-dot" style={{ background: seg.color }} />
            {seg.label}
            <strong>{seg.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const { branchId, branchName } = useBranch();

  const load = useCallback(() => {
    api.getStats().then(setStats).catch(console.error);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, [load, branchId]);

  const monthly = useMemo(
    () => buildMonthlySeries(stats?.monthlyActivity),
    [stats?.monthlyActivity],
  );

  const maxMonthly = useMemo(
    () => Math.max(...monthly.map((m) => m.count), 1),
    [monthly],
  );

  const typeBars = useMemo(() => {
    const rows = stats?.docsByType || [];
    const max = Math.max(...rows.map((r) => r.count), 1);
    return rows
      .slice()
      .sort((a, b) => b.count - a.count)
      .map((row) => ({
        ...row,
        pct: (row.count / max) * 100,
        label: DOC_TYPE_LABELS[row.type] || row.type,
        color: TYPE_COLORS[row.type] || 'var(--primary)',
      }));
  }, [stats?.docsByType]);

  const statusSegments = useMemo(() => (
    (stats?.docsByStatus || []).map((row) => ({
      key: row.status,
      label: STATUS_LABELS[row.status] || row.status,
      value: row.count,
      color: STATUS_COLORS[row.status] || 'var(--text-muted)',
    }))
  ), [stats?.docsByStatus]);

  const flowMax = useMemo(
    () => Math.max(stats?.prihodTotal || 0, stats?.rashodTotal || 0, 1),
    [stats?.prihodTotal, stats?.rashodTotal],
  );

  const topMax = useMemo(
    () => Math.max(...(stats?.topProducts || []).map((p) => p.value), 1),
    [stats?.topProducts],
  );

  if (!stats) return <div className="empty">Загрузка...</div>;

  const netFlow = (stats.prihodTotal || 0) - (stats.rashodTotal || 0);

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h1>Главная</h1>
        <BranchChip>{branchName}</BranchChip>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Товаров на складе</div>
          <div className="value">{stats.products}</div>
        </div>
        <div className="stat-card">
          <div className="label">Стоимость склада</div>
          <div className="value">{formatMoney(stats.stockValue)}</div>
        </div>
        <div className="stat-card prihod">
          <div className="label">Приход (проведён)</div>
          <div className="value">{formatMoney(stats.prihodTotal)}</div>
        </div>
        <div className="stat-card rashod">
          <div className="label">Расход (проведён)</div>
          <div className="value">{formatMoney(stats.rashodTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Всего документов</div>
          <div className="value">{stats.documents}</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-panel dash-panel-wide">
          <div className="dash-panel-head">
            <h3>Движение по сумме</h3>
            <span className={`dash-net${netFlow >= 0 ? ' dash-net-plus' : ' dash-net-minus'}`}>
              {netFlow >= 0 ? '+' : ''}{formatMoney(netFlow)}
            </span>
          </div>
          <div className="dash-flow">
            <div className="dash-flow-row">
              <span className="dash-flow-label">Приход</span>
              <div className="dash-flow-track">
                <div
                  className="dash-flow-bar dash-flow-bar-prihod"
                  style={{ width: `${((stats.prihodTotal || 0) / flowMax) * 100}%` }}
                />
              </div>
              <span className="dash-flow-value">{formatMoney(stats.prihodTotal)}</span>
            </div>
            <div className="dash-flow-row">
              <span className="dash-flow-label">Расход</span>
              <div className="dash-flow-track">
                <div
                  className="dash-flow-bar dash-flow-bar-rashod"
                  style={{ width: `${((stats.rashodTotal || 0) / flowMax) * 100}%` }}
                />
              </div>
              <span className="dash-flow-value">{formatMoney(stats.rashodTotal)}</span>
            </div>
          </div>
          <div className="dash-mini-stats">
            <div className="dash-mini-stat">
              <span>Проведено</span>
              <strong>{stats.confirmedDocs || 0}</strong>
            </div>
            <div className="dash-mini-stat">
              <span>Черновики</span>
              <strong>{stats.draftDocs || 0}</strong>
            </div>
            <div className="dash-mini-stat">
              <span>Остаток склада</span>
              <strong>{formatMoney(stats.stockValue)}</strong>
            </div>
          </div>
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>Документы по типам</h3>
          </div>
          {typeBars.length === 0 ? (
            <div className="dash-chart-empty">Пока нет документов</div>
          ) : (
            <div className="dash-bars">
              {typeBars.map((row) => (
                <div key={row.type} className="dash-bar-row">
                  <span className="dash-bar-label">{row.label}</span>
                  <div className="dash-bar-track">
                    <div
                      className="dash-bar-fill"
                      style={{ width: `${row.pct}%`, background: row.color }}
                    />
                  </div>
                  <span className="dash-bar-meta">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>Статусы документов</h3>
          </div>
          <DonutChart segments={statusSegments} emptyLabel="Нет документов" />
        </div>

        <div className="dash-panel dash-panel-wide">
          <div className="dash-panel-head">
            <h3>Активность за 6 месяцев</h3>
            <span className="dash-panel-note">проведённые документы</span>
          </div>
          <div className="dash-columns">
            {monthly.map((m) => (
              <div key={m.month} className="dash-column">
                <div className="dash-column-bar-wrap">
                  <div
                    className="dash-column-bar"
                    style={{ height: `${(m.count / maxMonthly) * 100}%` }}
                    title={`${m.count} док. · ${formatMoney(m.total)}`}
                  />
                </div>
                <span className="dash-column-label">{m.label}</span>
                <span className="dash-column-count">{m.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>Топ по стоимости остатка</h3>
            <Link to="/reports/stock" className="dash-panel-link">Отчёт →</Link>
          </div>
          {(stats.topProducts || []).length === 0 ? (
            <div className="dash-chart-empty">Нет товаров с остатком</div>
          ) : (
            <div className="dash-rank-list">
              {(stats.topProducts || []).map((p, idx) => (
                <div key={p.id} className="dash-rank-item">
                  <span className="dash-rank-num">{idx + 1}</span>
                  <div className="dash-rank-body">
                    <div className="dash-rank-title">{p.name}</div>
                    <div className="dash-rank-sub">
                      {p.stock} {p.unit || 'шт'} · {formatMoney(p.price)}
                    </div>
                    <div className="dash-rank-track">
                      <div
                        className="dash-rank-fill"
                        style={{ width: `${(p.value / topMax) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="dash-rank-value">{formatMoney(p.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>Мало на складе</h3>
            <span className="dash-panel-note">≤ 10 ед.</span>
          </div>
          {(stats.lowStock || []).length === 0 ? (
            <div className="dash-chart-empty dash-chart-empty-ok">Критичных остатков нет</div>
          ) : (
            <ul className="dash-alert-list">
              {(stats.lowStock || []).map((p) => (
                <li key={`${p.name}-${p.stock}`}>
                  <span>{p.name}</span>
                  <strong>{p.stock} {p.unit || 'шт'}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
