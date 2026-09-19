import { Link } from 'react-router-dom';
import { IconNavTelegram } from './NavIcons';

/**
 * Мобильный рабочий стол в стиле 1С: сетка «Быстрый доступ» + Telegram.
 */
export default function MobileWorkspaceHome({ links, showTelegram = false }) {
  return (
    <div className="mobile-workspace ones-c">
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

      <div className="mobile-workspace-footer">
        {showTelegram && (
          <Link to="/telegram" className="mobile-workspace-telegram">
            <IconNavTelegram />
            <span>Telegram</span>
          </Link>
        )}
      </div>
    </div>
  );
}
