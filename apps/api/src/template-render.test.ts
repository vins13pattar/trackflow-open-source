import { describe, expect, it } from 'vitest';
import { render } from './template-service.js';

describe('render', () => {
  it('substitutes single and multiple variables', () => {
    expect(render('Hello {{name}}!', { name: 'Vinod' })).toBe('Hello Vinod!');
    expect(render('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 })).toBe('1 + 2 = 3');
  });

  it('tolerates whitespace inside placeholders', () => {
    expect(render('Hi {{  name  }}', { name: 'Vinod' })).toBe('Hi Vinod');
  });

  it('renders missing/undefined variables as empty', () => {
    expect(render('Hi {{name}}, {{count}} alerts', { count: 0 })).toBe('Hi , 0 alerts');
    expect(render('{{missing}}', {})).toBe('');
  });

  it('leaves non-placeholder text intact (no regex bleed)', () => {
    expect(render('{not-a-tag} {single} {{nope', {})).toBe('{not-a-tag} {single} {{nope');
  });
});
