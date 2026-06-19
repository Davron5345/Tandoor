import Modal from '../Modal';
import { BLOCK_TEMPLATES } from '../../utils/myShopLayout';

function TemplatePreview({ layout }) {
  return (
    <div className={`myshop-template-preview myshop-template-${layout}`} aria-hidden>
      {layout === 'grid-3-2' && (
        <>
          <span /><span /><span /><span /><span />
        </>
      )}
      {layout === 'grid-2-3' && (
        <>
          <span /><span /><span /><span /><span />
        </>
      )}
      {layout === 'grid-3-3' && Array.from({ length: 9 }, (_, i) => <span key={i} />)}
      {layout === 'grid-1-2' && (
        <>
          <span className="wide" /><span /><span />
        </>
      )}
      {layout === 'grid-2-1' && (
        <>
          <span /><span /><span className="wide" />
        </>
      )}
      {layout === 'checkerboard' && (
        <>
          <span className="wide" /><span /><span /><span className="wide" />
        </>
      )}
      {layout === 'grid-3' && (
        <>
          <span /><span /><span />
        </>
      )}
      {layout === 'grid-2' && (
        <>
          <span /><span />
        </>
      )}
      {(layout === 'grid-3n' || layout === 'grid-2n') && (
        <>
          <span /><span /><span /><span /><span /><span />
        </>
      )}
      {layout === 'slider' && <span className="wide" />}
    </div>
  );
}

function TemplateCard({ type, meta, onSelect }) {
  return (
    <button type="button" className="myshop-template-card" onClick={() => onSelect(type)}>
      <TemplatePreview layout={meta.layout} />
      <strong>{meta.label}</strong>
      <span>{meta.hint}</span>
    </button>
  );
}

export default function BlockAddModal({ onClose, onSelect }) {
  const templates = Object.entries(BLOCK_TEMPLATES).filter(([, meta]) => meta.group === 'template');
  const singles = Object.entries(BLOCK_TEMPLATES).filter(([, meta]) => meta.group === 'single');

  return (
    <Modal title="Добавление блока меню" onClose={onClose} wide className="myshop-add-modal">
      <div className="myshop-template-section">
        <h3>Готовые шаблоны</h3>
        <div className="myshop-template-grid">
          {templates.map(([type, meta]) => (
            <TemplateCard key={type} type={type} meta={meta} onSelect={onSelect} />
          ))}
        </div>
      </div>
      <div className="myshop-template-section">
        <h3>Отдельные блоки</h3>
        <div className="myshop-template-grid myshop-template-grid-compact">
          {singles.map(([type, meta]) => (
            <TemplateCard key={type} type={type} meta={meta} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
