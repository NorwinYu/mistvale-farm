export const CROPS = {
  carrot: {
    id: 'carrot', name: '胡萝卜', en: 'Carrot', seedPrice: 8, sell: 22, days: 3,
    color: '#d7883e', leaf: '#75894b', description: '清脆微甜，山雀也喜欢。',
  },
  wheat: {
    id: 'wheat', name: '小麦', en: 'Wheat', seedPrice: 9, sell: 21, days: 3,
    color: '#c1a25d', leaf: '#8e9655', description: '风一吹，田野就有了声音。',
  },
  tomato: {
    id: 'tomato', name: '番茄', en: 'Tomato', seedPrice: 16, sell: 40, days: 3,
    color: '#b94b34', leaf: '#5d753e', description: '被山里的太阳晒得饱满。',
  },
  sunflower: {
    id: 'sunflower', name: '向日葵', en: 'Sunflower', seedPrice: 20, sell: 48, days: 3,
    color: '#d9b344', leaf: '#657a3f', description: '总把脸转向最亮的地方。',
  },
  pumpkin: {
    id: 'pumpkin', name: '南瓜', en: 'Pumpkin', seedPrice: 26, sell: 64, days: 3,
    color: '#c5752c', leaf: '#66793e', description: '沉甸甸的，适合炖一锅浓汤。',
  },
};

export const ITEMS = {
  egg: { id: 'egg', name: '鸡蛋', sell: 9, color: '#e3d7bf', description: '母鸡留下的温热问候。' },
  milk: { id: 'milk', name: '牛奶', sell: 24, color: '#e8e1d0', description: '花卷今早的馈赠。' },
};

export const WEATHER = {
  sunny: { id: 'sunny', name: '晴朗', temp: 19, note: '阳光很好，适合把种子埋进土里。' },
  cloudy: { id: 'cloudy', name: '多云', temp: 16, note: '云影慢慢走过山谷，风是凉的。' },
  rain: { id: 'rain', name: '小雨', temp: 13, note: '雨水会替你浇灌菜圃，今天适合待在家里。' },
};

export const SEASONS = ['春', '夏', '秋', '冬'];
export const SEASON_EN = { 春: 'SPRING', 夏: 'SUMMER', 秋: 'AUTUMN', 冬: 'WINTER' };

export function seasonForDay(day) {
  return SEASONS[Math.floor((Math.max(1, day) - 1) / 28) % 4];
}

export function formatInGameTime(minutes) {
  let total = Math.floor(minutes) % (24 * 60);
  if (total < 0) total += 24 * 60;
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function weatherForDay(day) {
  if (day <= 2) return 'sunny';
  // A stable, gentle weather rhythm for a valley that rarely storms.
  let h = Math.sin(day * 12.9898 + 78.233) * 43758.5453;
  h = h - Math.floor(h);
  if (h < 0.22) return 'rain';
  if (h < 0.48) return 'cloudy';
  return 'sunny';
}
