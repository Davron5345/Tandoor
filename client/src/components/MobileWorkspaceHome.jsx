import { Link } from 'react-router-dom';
import { IconNavTelegram } from './NavIcons';

/**
 * Мобильный рабочий стол: сетка быстрого доступа + Telegram (как в примере).
 */
export default function MobileWorkspaceHome({ links, showTelegram = false }) {
  return (
    <div className="mobile-workspace">
      <div className="mobile-workspace-subheader">Быстрый доступ</div>

      <nav className="mobile-workspace-grid" aria-label="Быстрый доступ">
        {links.map((item) => {
          const Icon = item.Icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`mobile-workspace-item tone-${item.tone}${item.highlight ? ' is-highlight' : ''}`}
            >
              <span className="mobile-workspace-icon" aria-hidden>
                <Icon />
              </span>
              <span className="mobile-workspace-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {showTelegram && (
        <Link to="/telegram" className="mobile-workspace-telegram">
          <IconNavTelegram />
          <span>Telegram</span>
        </Link>
      )}
    </div>
  );
}
