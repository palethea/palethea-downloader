import { useState, useRef, useEffect } from 'react';

function ChevronDown({ isOpen }) {
  return (
    <svg 
      width="16" height="16" viewBox="0 0 24 24" 
      fill="none" stroke="currentColor" strokeWidth="2" 
      strokeLinecap="round" strokeLinejoin="round"
      style={{
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s',
        marginLeft: '4px'
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function CustomDropdown({ value, onChange, options, prefixLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  return (
    <div className={`custom-dropdown ${isOpen ? 'open' : ''}`} ref={ref}>
      <button 
        type="button" 
        className={`dropdown-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {prefixLabel && <span className="dropdown-prefix">{prefixLabel}:</span>}
        <span className="dropdown-label">{selectedOption?.label || value}</span>
        <ChevronDown isOpen={isOpen} />
      </button>

      {isOpen && (
        <div className="dropdown-menu">
          <div className="dropdown-menu-inner">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`dropdown-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    if (!isSelected) {
                      onChange(opt.value);
                    }
                    setIsOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
