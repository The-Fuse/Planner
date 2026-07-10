// Single source of truth for subject accent colors (token palette hexes)
export const SUBJECT_COLORS: Record<string, { text: string; bg: string; hex: string }> = {
    Polity:               { text: 'text-primary',   bg: 'bg-primary',   hex: '#adc6ff' },
    History:              { text: 'text-secondary', bg: 'bg-secondary', hex: '#c2c1ff' },
    Economy:              { text: 'text-tertiary',  bg: 'bg-tertiary',  hex: '#68d3ff' },
    'Western Philosophy': { text: 'text-primary',   bg: 'bg-primary',   hex: '#adc6ff' },
    'Indian Philosophy':  { text: 'text-secondary', bg: 'bg-secondary', hex: '#c2c1ff' },
    Ethics:               { text: 'text-tertiary',  bg: 'bg-tertiary',  hex: '#68d3ff' },
    'Art & Culture':      { text: 'text-error',     bg: 'bg-error',     hex: '#ffb4ab' },
};

export const subjectColor = (subject: string) => SUBJECT_COLORS[subject] ?? SUBJECT_COLORS.Polity;
