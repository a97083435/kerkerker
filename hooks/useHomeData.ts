import { useState, useEffect, useCallback, startTransition } from "react";
import type { DoubanMovie } from "@/types/douban";
import type { CategoryData, HeroData, HeroMovie } from "@/types/home";

interface UseHomeDataReturn {
  categories: CategoryData[];
  heroMovies: DoubanMovie[];
  heroDataList: HeroData[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * 管理首页数据加载
 * 采用串行加载策略，优先加载用户最先看到的内容
 */
export function useHomeData(): UseHomeDataReturn {
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [heroMovies, setHeroMovies] = useState<DoubanMovie[]>([]);
  const [heroDataList, setHeroDataList] = useState<HeroData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // 1️⃣ 优先加载 Hero Banner（用户第一眼看到）
      const heroRes = await fetch("/api/douban/hero");
      if (!heroRes.ok) throw new Error("Hero数据加载失败");
      const heroApiData = await heroRes.json();

      // 处理 Hero Banner 数据（现在是数组）
      if (heroApiData.code === 200 && heroApiData.data && Array.isArray(heroApiData.data)) {
        const heroes = heroApiData.data;
        const heroMoviesList: HeroMovie[] = heroes.map((hero: {
          id: string;
          title: string;
          cover: string;
          url: string;
          rate: string;
          episode_info?: string;
          poster_horizontal: string;
          poster_vertical: string;
          description?: string;
          genres?: string[];
        }) => ({
          id: hero.id,
          title: hero.title,
          cover: hero.cover || "",
          url: hero.url || "",
          rate: hero.rate || "",
          episode_info: hero.episode_info || "",
          cover_x: 0,
          cover_y: 0,
          playable: false,
          is_new: false,
        }));

        const heroDataArray: HeroData[] = heroes.map((hero: {
          poster_horizontal: string;
          poster_vertical: string;
          description?: string;
          genres?: string[];
        }) => ({
          poster_horizontal: hero.poster_horizontal,
          poster_vertical: hero.poster_vertical,
          description: hero.description,
          genres: hero.genres,
        }));

        setHeroMovies(heroMoviesList);
        setHeroDataList(heroDataArray);
        
        // Hero 加载完成后，立即结束 loading 状态，让用户可以交互
        setLoading(false);
      }

      // 2️⃣ 加载分类数据（用户滚动后看到）
      const newApiRes = await fetch("/api/douban/new");
      if (newApiRes.ok) {
        const newApiData = await newApiRes.json();
        if (newApiData.code === 200 && newApiData.data) {
          // 使用 startTransition 让 UI 更新不阻塞交互
          startTransition(() => {
            setCategories(newApiData.data);
          });
        }
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : "数据加载失败，请稍后重试");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    categories,
    heroMovies,
    heroDataList,
    loading,
    error,
    refetch: fetchData,
  };
}
