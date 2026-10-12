// Робот: настоящий QR не нужен — сетка-заглушка того же вида.
const make = () => ({ modules: { size: 21, get: (x: number, y: number) => (x * y + x) % 3 === 0 } });
export default { create: make };
export const create = make;
