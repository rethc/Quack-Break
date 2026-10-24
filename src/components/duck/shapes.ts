// Duck drawn in a 200 x 200 box, facing right. Same shapes as assets/source/*.svg.
export const duckColors = {
  body: '#FFD54F',
  shade: '#F5B935',
  wing: '#F9C23C',
  beak: '#FF9F43',
  beakLine: '#E57C22',
  foot: '#FF9F43',
  footBack: '#F08B2E',
  eye: '#33294A',
  cheek: '#FF8FA3',
  beanie: '#7FC6E4',
  beanieBand: '#2F6E8C',
  bow: '#FF8FA3',
  bowKnot: '#E5677F',
  scarf: '#E5677F',
};

export const duckPaths = {
  footBack:
    'M106 158 L106 174 Q106 178 102 179 L94 183 Q90 186 95 188 L124 188 Q129 187 126 183 L118 178 Q115 176 115 172 L115 158 Z',
  footFront:
    'M80 158 L80 174 Q80 178 76 179 L68 183 Q64 186 69 188 L98 188 Q103 187 100 183 L92 178 Q89 176 89 172 L89 158 Z',
  body: 'M40 124 C33 104 27 88 33 74 C47 89 66 93 86 89 C114 83 152 94 161 122 C169 150 141 172 100 172 C63 172 45 151 40 124 Z',
  belly: 'M52 146 C66 166 92 172 112 170 C136 168 154 156 160 138 C150 156 128 164 104 164 C84 164 64 158 52 146 Z',
  tuft: 'M121 31 C114 21 118 10 130 9 C125 15 126 22 133 29 Z',
  beak: 'M153 58 C165 51 184 54 187 64 C189 73 172 79 155 76 C151 70 150 64 153 58 Z',
  beakLine: 'M157 68 Q170 70 185 67',
  wing: 'M118 108 C122 126 110 142 88 144 C72 145 58 138 52 128 C64 132 74 130 80 126 C70 126 62 120 60 114 C74 116 84 112 90 106 C100 100 114 100 118 108 Z',
  eyeHappy: 'M133 57 Q140 48 147 57',
  eyeClosed: 'M133 54 Q140 62 147 54',
  // Growth: tail feathers (young, grown), wing tips (grown), crown (pond legend).
  tail: 'M36 80 C26 70 22 58 26 48 C31 58 38 66 46 72 Z',
  tail2: 'M42 84 C36 76 36 66 40 60 C42 68 46 74 52 78 Z',
  wingTip: 'M60 114 C74 116 84 112 90 106 C86 115 74 121 60 114 Z',
  crown: 'M112 34 L115 17 L123 27 L129 12 L135 27 L143 17 L146 34 Z',
  // Things to wear. The beanie's band stays above the eye.
  beanie: 'M100 42 C101 20 116 12 130 12 C145 12 159 20 160 42 Z',
  beanieBand: 'M102 36 L158 36 Q163 36 163 41 Q163 46 158 46 L102 46 Q97 46 97 41 Q97 36 102 36 Z',
  bow: 'M116 30 L100 21 L100 39 Z M116 30 L132 21 L132 39 Z',
  scarf: 'M100 86 Q130 100 160 84 L162 94 Q130 112 98 96 Z',
  scarfEnd: 'M108 96 L102 122 L113 123 L118 99 Z',
};

// Pivot points as percentages of the box, for CSS-style transformOrigin.
export const pivots = {
  wing: '58% 53%',
  footFront: '42% 79%',
  footBack: '55% 79%',
  eye: '70% 27.5%',
  body: '50% 94%',
};
