import { api } from "./api";

export async function getTop10(tipo: "pontos" | "coletas") {
  try {

    const response = await api.get(`/ranking/doadores`, {
      params: {
        limit: 10,
        tipo,
      },
    });


    return response.data;
  } catch (error: any) {

    if (error.response) {
    } else {
    }

    throw error;
  }
}//tudo funcionando e muito e massa