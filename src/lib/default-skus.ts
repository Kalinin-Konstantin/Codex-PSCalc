import type { SkuInput } from "./types";

export const defaultSkus: SkuInput[] = [
  {
    id: "hanger",
    name: "Вешалки",
    price: 4050,
    wbCategory: "Мебель корпусная и мебель для хранения",
    wbSubject: "Вешалки настенные",
    ozonCategory: "Вешалки для одежды",
    ozonProductType: "Вешалка настенная",
    weightKg: 3.9,
    lengthCm: 107,
    widthCm: 8,
    heightCm: 49,
    itemsPerPallet: 30
  },
  {
    id: "cabinet",
    name: "Тумбочка",
    price: 4000,
    wbCategory: "Мебель корпусная и мебель для хранения",
    wbSubject: "Тумбы",
    ozonCategory: "Комоды, тумбы и туалетные столики",
    ozonProductType: "Тумба",
    weightKg: 13,
    lengthCm: 55,
    widthCm: 15,
    heightCm: 43,
    itemsPerPallet: 40
  },
  {
    id: "table",
    name: "Столик",
    price: 14500,
    wbCategory: "Мебель малых форм",
    wbSubject: "Столы журнальные",
    ozonCategory: "Столы",
    ozonProductType: "Стол обеденный",
    weightKg: 21.1,
    lengthCm: 105,
    widthCm: 11,
    heightCm: 105,
    itemsPerPallet: 16
  }
];
