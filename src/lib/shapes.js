'use strict';

/**
 * Grid-art shape library.
 *
 * Every shape lives inside a 1x1 cell (coordinates 0..1, y down).
 * Placement adds rotation / mirror around the cell center, so families only
 * need one or a few base orientations.
 */

const SHAPE_VERSION = 1;

const GROUPS = [
  {
    id: 'blocks',
    name: 'Blocks',
    shapes: [
      { id: 'square', label: 'Full', d: 'M0 0H1V1H0Z' },
      { id: 'rect-left', label: 'Half ◧', d: 'M0 0H0.5V1H0Z' },
      { id: 'rect-top', label: 'Half ⬒', d: 'M0 0H1V0.5H0Z' },
      { id: 'quarter', label: 'Quarter ◰', d: 'M0 0H0.5V0.5H0Z' },
      { id: 'stair', label: 'Stair ◰', d: 'M0.5 0H1V1H0V0.5H0.5Z' },
      {
        id: 'center-third',
        label: 'Center 1/3',
        d: 'M0.3333 0.3333H0.6667V0.6667H0.3333Z',
      },
      {
        id: 'center-half',
        label: 'Center 1/2',
        d: 'M0.25 0.25H0.75V0.75H0.25Z',
      },
      {
        id: 'center-two-thirds',
        label: 'Center 2/3',
        d: 'M0.1667 0.1667H0.8333V0.8333H0.1667Z',
      },
      {
        id: 'plus',
        label: 'Plus',
        d: 'M0.3333 0H0.6667V0.3333H1V0.6667H0.6667V1H0.3333V0.6667H0V0.3333H0.3333Z',
      },
      { id: 'bar-h', label: 'Bar —', d: 'M0 0.375H1V0.625H0Z' },
      { id: 'bar-v', label: 'Bar |', d: 'M0.375 0H0.625V1H0.375Z' },
    ],
  },
  {
    id: 'triangles',
    name: 'Triangles',
    shapes: [
      { id: 'tri-diag-tl', label: 'Diag ◤', d: 'M0 0H1L0 1Z' },
      { id: 'tri-diag-tr', label: 'Diag ◥', d: 'M0 0H1V1Z' },
      { id: 'tri-diag-br', label: 'Diag ◢', d: 'M1 1H0L1 0Z' },
      { id: 'tri-diag-bl', label: 'Diag ◣', d: 'M0 0V1H1Z' },
      { id: 'tri-in-top', label: 'In ↑', d: 'M0 0H1L0.5 0.5Z' },
      { id: 'tri-in-right', label: 'In →', d: 'M1 0V1L0.5 0.5Z' },
      { id: 'tri-in-bottom', label: 'In ↓', d: 'M1 1H0L0.5 0.5Z' },
      { id: 'tri-in-left', label: 'In ←', d: 'M0 1V0L0.5 0.5Z' },
      { id: 'tri-out-tl', label: 'Out ↖', d: 'M0 0H0.5L0 0.5Z' },
      { id: 'tri-out-tr', label: 'Out ↗', d: 'M1 0V0.5L0.5 0Z' },
      { id: 'tri-out-br', label: 'Out ↘', d: 'M1 1H0.5L1 0.5Z' },
      { id: 'tri-out-bl', label: 'Out ↙', d: 'M0 1V0.5L0.5 1Z' },
      { id: 'tri-quarter-a', label: 'Quarter A', d: 'M0 0H0.5V0.5Z' },
      { id: 'tri-quarter-b', label: 'Quarter B', d: 'M0 0L0.5 0.5H0Z' },
      { id: 'tri-iso-up', label: 'Iso ↑', d: 'M0 1H1L0.5 0Z' },
      { id: 'tri-iso-right', label: 'Iso →', d: 'M0 0V1L1 0.5Z' },
      { id: 'tri-iso-down', label: 'Iso ↓', d: 'M0 0H1L0.5 1Z' },
      { id: 'tri-iso-left', label: 'Iso ←', d: 'M1 0V1L0 0.5Z' },
      { id: 'tri-small-top', label: 'Small ↑', d: 'M0.25 0H0.75L0.5 0.5Z' },
      { id: 'tri-small-bottom', label: 'Small ↓', d: 'M0.25 1H0.75L0.5 0.5Z' },
      { id: 'tri-small-left', label: 'Small ←', d: 'M0 0.25V0.75L0.5 0.5Z' },
      { id: 'tri-small-right', label: 'Small →', d: 'M1 0.25V0.75L0.5 0.5Z' },
    ],
  },
  {
    id: 'circles',
    name: 'Circles',
    shapes: [
      {
        id: 'circle',
        label: 'Circle',
        d: 'M0.5 0A0.5 0.5 0 1 1 0.5 1A0.5 0.5 0 1 1 0.5 0Z',
      },
      {
        id: 'circle-3q',
        label: 'Circle 3/4',
        d: 'M0.5 0.125A0.375 0.375 0 1 1 0.5 0.875A0.375 0.375 0 1 1 0.5 0.125Z',
      },
      {
        id: 'circle-2-3',
        label: 'Circle 2/3',
        d: 'M0.5 0.1667A0.3333 0.3333 0 1 1 0.5 0.8333A0.3333 0.3333 0 1 1 0.5 0.1667Z',
      },
      {
        id: 'circle-half',
        label: 'Circle 1/2',
        d: 'M0.5 0.25A0.25 0.25 0 1 1 0.5 0.75A0.25 0.25 0 1 1 0.5 0.25Z',
      },
      {
        id: 'circle-third',
        label: 'Circle 1/3',
        d: 'M0.5 0.3333A0.1667 0.1667 0 1 1 0.5 0.6667A0.1667 0.1667 0 1 1 0.5 0.3333Z',
      },
      { id: 'semi-a', label: 'Semi ◒', d: 'M0 0.5A0.5 0.5 0 0 1 1 0.5Z' },
      { id: 'semi-b', label: 'Semi ◓', d: 'M0 0.5A0.5 0.5 0 0 0 1 0.5Z' },
      { id: 'quarter-tl', label: 'Quarter ↖', d: 'M0 0L1 0A1 1 0 0 1 0 1Z' },
      { id: 'quarter-tr', label: 'Quarter ↗', d: 'M1 0L1 1A1 1 0 0 1 0 0Z' },
      { id: 'quarter-br', label: 'Quarter ↘', d: 'M1 1L0 1A1 1 0 0 1 1 0Z' },
      { id: 'quarter-bl', label: 'Quarter ↙', d: 'M0 1L0 0A1 1 0 0 1 1 1Z' },
      {
        id: 'quarter-small-tl',
        label: 'Small ↖',
        d: 'M0 0L0.5 0A0.5 0.5 0 0 1 0 0.5Z',
      },
      {
        id: 'quarter-small-br',
        label: 'Small ↘',
        d: 'M1 1L0.5 1A0.5 0.5 0 0 1 1 0.5Z',
      },
      {
        id: 'pie-br',
        label: 'Pie ↘',
        d: 'M0.5 0.5L1 0.5A0.5 0.5 0 0 1 0.5 1Z',
      },
      {
        id: 'ring',
        label: 'Ring',
        d: 'M0.5 0A0.5 0.5 0 1 1 0.5 1A0.5 0.5 0 1 1 0.5 0Z M0.5 0.25A0.25 0.25 0 1 0 0.5 0.75A0.25 0.25 0 1 0 0.5 0.25Z',
        fillRule: 'evenodd',
      },
      {
        id: 'ring-small',
        label: 'Ring 1/2',
        d: 'M0.5 0.1667A0.3333 0.3333 0 1 1 0.5 0.8333A0.3333 0.3333 0 1 1 0.5 0.1667Z M0.5 0.3333A0.1667 0.1667 0 1 0 0.5 0.6667A0.1667 0.1667 0 1 0 0.5 0.3333Z',
        fillRule: 'evenodd',
      },
      { id: 'diamond', label: 'Diamond', d: 'M0.5 0L1 0.5L0.5 1L0 0.5Z' },
      {
        id: 'diamond-small',
        label: 'Diamond 1/2',
        d: 'M0.5 0.25L0.75 0.5L0.5 0.75L0.25 0.5Z',
      },
    ],
  },
];

const SHAPES = GROUPS.flatMap((group) =>
  group.shapes.map((shape) => ({ ...shape, group: group.id })),
);
const SHAPE_MAP = new Map(SHAPES.map((shape) => [shape.id, shape]));

function getShape(id) {
  return SHAPE_MAP.get(id) || SHAPE_MAP.get('square');
}

function shapeGroups() {
  return GROUPS.map((group) => ({
    id: group.id,
    name: group.name,
    shapes: group.shapes.map((shape) => ({ ...shape })),
  }));
}

module.exports = {
  SHAPE_VERSION,
  SHAPES,
  GROUPS,
  getShape,
  shapeGroups,
  shapeIds: SHAPES.map((shape) => shape.id),
};
