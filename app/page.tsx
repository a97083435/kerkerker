"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, Film, Tv, Drama, Clapperboard, Palette, BookOpen, Star, ChevronLeft, ChevronRight } from "lucide-react";
import DoubanCard from "@/components/DoubanCard";
import { DoubanMovie } from "@/types/douban";
import { Toast } from "@/components/Toast";

// 定义新 API 返回的数据结构
interface NewApiMovie {
  id: string;
  title: string;
  rate: string;
  cover: string;
  url: string;
  [key: string]: unknown;
}

interface CategoryData {
  name: string;
  data: NewApiMovie[];
}

export default function HomePage() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");

  // 所有分类数据
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [top250Movies, setTop250Movies] = useState<DoubanMovie[]>([]);
  const [heroMovies, setHeroMovies] = useState<DoubanMovie[]>([]);
  const [heroDataList, setHeroDataList] = useState<Array<{
    poster_horizontal: string;
    poster_vertical: string;
    description?: string;
    genres?: string[];
  }>>([]);
  const [currentHeroIndex, setCurrentHeroIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchingMovie, setMatchingMovie] = useState<string | null>(null);
  // Toast 通知状态
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "warning" | "info";
  } | null>(null);

  // 智能获取图片URL
  const getImageUrl = (imageUrl: string) => {
    return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  };

  // 监听滚动
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 加载数据
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 并行加载 Hero、新 API 数据和 Top250
      const [heroRes, newApiRes, top250Res] = await Promise.all([
        fetch("/api/douban/hero"),
        fetch("/api/douban/new"),
        fetch("/api/douban/250"),
      ]);

      if (!heroRes.ok || !newApiRes.ok || !top250Res.ok) {
        throw new Error("数据加载失败");
      }

      const [heroApiData, newApiData, top250Data] = await Promise.all([
        heroRes.json(),
        newApiRes.json(),
        top250Res.json(),
      ]);

      // 处理 Hero Banner 数据（现在是数组）
      if (heroApiData.code === 200 && heroApiData.data && Array.isArray(heroApiData.data)) {
        const heroes = heroApiData.data;
        const heroMoviesList = heroes.map((hero: {
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

        const heroDataArray = heroes.map((hero: {
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
      }

      // 处理新 API 数据（9个分类）
      if (newApiData.code === 200 && newApiData.data) {
        setCategories(newApiData.data);
      }

      // 处理 Top250 数据
      if (top250Data.code === 200 && top250Data.data?.subjects) {
        setTop250Movies(top250Data.data.subjects);
      }
    } catch (error) {
      console.error("加载数据失败:", error);
      setError(
        error instanceof Error ? error.message : "数据加载失败，请稍后重试"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 自动轮播 Hero
  useEffect(() => {
    if (heroMovies.length <= 1) return;

    const timer = setInterval(() => {
      setCurrentHeroIndex((prevIndex) => (prevIndex + 1) % heroMovies.length);
    }, 5000); // 每5秒切换一次

    return () => clearInterval(timer);
  }, [heroMovies.length]);

  // 手动切换 Hero
  const goToHero = (index: number) => {
    setCurrentHeroIndex(index);
  };

  const goToPrevHero = () => {
    setCurrentHeroIndex((prevIndex) => 
      prevIndex === 0 ? heroMovies.length - 1 : prevIndex - 1
    );
  };

  const goToNextHero = () => {
    setCurrentHeroIndex((prevIndex) => 
      (prevIndex + 1) % heroMovies.length
    );
  };

  // 搜索跳转
  const handleSearch = async () => {
    if (!searchKeyword.trim()) return;
    router.push(`/search?q=${encodeURIComponent(searchKeyword)}`);
  };

  // 点击影片
  const handleMovieClick = async (movie: DoubanMovie) => {
    setMatchingMovie(movie.id);
    try {
      const response = await fetch("/api/douban/match-vod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          douban_id: movie.id,
          title: movie.title,
        }),
      });

      const result = await response.json();

      if (
        result.code === 200 &&
        result.data?.matches &&
        result.data.matches.length > 0
      ) {
        const matches = result.data.matches;

        localStorage.setItem(
          "multi_source_matches",
          JSON.stringify({
            douban_id: movie.id,
            title: movie.title,
            matches: matches,
            timestamp: Date.now(),
          })
        );

        const firstMatch = matches[0];
        router.push(
          `/play/${firstMatch.vod_id}?source=${firstMatch.source_key}&multi=true`
        );
      } else {
        setToast({
          message: `未在任何播放源中找到《${movie.title}》\n\n已搜索 ${
            result.data?.total_sources || 0
          } 个视频源`,
          type: "warning",
        });
      }
    } catch (error) {
      console.error("搜索播放源失败:", error);
      setToast({
        message: "搜索播放源时出错，请重试",
        type: "error",
      });
    } finally {
      setMatchingMovie(null);
    }
  };

  // 根据分类名称获取图标
  const getCategoryIcon = (name: string): React.JSX.Element => {
    const iconClass = "w-5 h-5";
    const iconMap: Record<string, React.JSX.Element> = {
      豆瓣热映: <Film className={iconClass} />,
      热门电视: <Tv className={iconClass} />,
      国产剧: <Drama className={iconClass} />,
      综艺: <Clapperboard className={iconClass} />,
      美剧: <Tv className={iconClass} />,
      日剧: <Drama className={iconClass} />,
      韩剧: <Drama className={iconClass} />,
      日本动画: <Palette className={iconClass} />,
      纪录片: <BookOpen className={iconClass} />,
    };
    return iconMap[name] || <Film className={iconClass} />;
  };

  // 根据分类名称获取分类页面的路径
  const getCategoryPath = (name: string) => {
    const pathMap: Record<string, string> = {
      豆瓣热映: "in_theaters",
      热门电视: "hot_tv",
      国产剧: "hot_tv",
      综艺: "hot_tv",
      美剧: "us_tv",
      日剧: "jp_tv",
      韩剧: "kr_tv",
      日本动画: "anime",
      纪录片: "hot_tv",
    };
    return pathMap[name] || "hot_movies";
  };

  return (
    <div className="min-h-screen bg-black">
      {/* 顶部导航栏 - Netflix 风格 */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-black"
            : "bg-gradient-to-b from-black/80 to-transparent"
        }`}
      >
        <div className="px-4 md:px-12 py-4 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center space-x-8">
            <div className="flex items-center gap-1">
              <img className="w-10 h-10" src="/logo.png" alt="logo" />
              <h1
                onClick={() => router.push("/")}
                className="text-red-600 text-2xl md:text-3xl font-bold tracking-tight cursor-pointer hover:text-red-500 transition-colors"
              >
                壳儿
              </h1>
            </div>
            {/* 导航链接 - 桌面端 */}
            <div className="hidden lg:flex items-center space-x-6">
              <button
                onClick={() => router.push("/")}
                className="text-white hover:text-gray-300 transition-colors text-sm font-medium"
              >
                首页
              </button>
              <button
                onClick={() => router.push("/movies")}
                className="text-gray-400 hover:text-gray-300 transition-colors text-sm"
              >
                电影
              </button>
              <button
                onClick={() => router.push("/tv")}
                className="text-gray-400 hover:text-gray-300 transition-colors text-sm"
              >
                电视剧
              </button>
              <button
                onClick={() => router.push("/latest")}
                className="text-gray-400 hover:text-gray-300 transition-colors text-sm"
              >
                最新
              </button>
              <a
                href="https://github.com/unilei/kerkerker"
                target="_blank"
                className="text-gray-400 hover:text-gray-300 transition-colors text-sm"
              >
                Github
              </a>
            </div>
          </div>

          {/* 右侧功能区 */}
          <div className="flex items-center space-x-4">
            {/* 搜索按钮 */}
            <button
              onClick={() => setShowSearch(true)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              title="搜索"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* 搜索弹窗 - Netflix 风格 */}
      {showSearch && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm transition-opacity duration-200">
          <div className="flex items-start justify-center pt-32 px-4">
            <div className="w-full max-w-3xl">
              {/* 搜索框 */}
              <div className="relative">
                <div className="flex items-center bg-white rounded-lg shadow-2xl overflow-hidden">
                  <div className="pl-6 pr-4 text-gray-400">
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSearch();
                      if (e.key === "Escape") setShowSearch(false);
                    }}
                    placeholder="搜索你想看的内容..."
                    className="flex-1 px-2 py-5 text-lg text-black outline-none placeholder:text-gray-400"
                    autoFocus
                  />
                  <button
                    onClick={() => setShowSearch(false)}
                    className="px-6 py-5 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {/* 提示文字 */}
                <div className="mt-4 text-center">
                  <p className="text-sm text-gray-400">
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">
                      Enter
                    </kbd>{" "}
                    开始搜索 •{" "}
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">
                      Esc
                    </kbd>{" "}
                    关闭
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 点击背景关闭 */}
          <div
            className="absolute inset-0 -z-10"
            onClick={() => setShowSearch(false)}
          />
        </div>
      )}

      {loading ? (
        /* 骨架屏加载状态 */
        <div className="pt-20">
          {/* Hero 骨架屏 */}
          <div className="relative h-[70vh] bg-gradient-to-br from-black via-zinc-950 to-black">
            {/* 动画光效 */}
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute -inset-[100%] animate-[spin_3s_linear_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            </div>
            
            <div className="absolute bottom-0 left-0 right-0 px-4 md:px-12 pb-12 md:pb-20">
              <div className="max-w-2xl space-y-4">
                {/* 标题骨架 */}
                <div className="h-16 bg-gradient-to-r from-zinc-900 to-zinc-900/50 rounded-lg w-3/4 animate-pulse" />
                {/* 副标题骨架 */}
                <div className="h-6 bg-gradient-to-r from-zinc-900 to-zinc-900/50 rounded-lg w-1/2 animate-pulse" />
                {/* 描述骨架 */}
                <div className="space-y-2">
                  <div className="h-5 bg-gradient-to-r from-zinc-900 to-zinc-900/50 rounded-lg w-full animate-pulse" />
                  <div className="h-5 bg-gradient-to-r from-zinc-900 to-zinc-900/50 rounded-lg w-5/6 animate-pulse" />
                  <div className="h-5 bg-gradient-to-r from-zinc-900 to-zinc-900/50 rounded-lg w-4/5 animate-pulse" />
                </div>
                {/* 按钮骨架 */}
                <div className="flex space-x-3 pt-2">
                  <div className="h-12 bg-gradient-to-r from-zinc-800 to-zinc-900 rounded-lg w-32 animate-pulse" />
                  <div className="h-12 bg-gradient-to-r from-zinc-900 to-zinc-900/50 rounded-lg w-32 animate-pulse" />
                </div>
              </div>
            </div>
          </div>

          {/* 分类骨架屏 */}
          <div className="relative z-20 -mt-8 space-y-12 pb-16">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 md:px-12">
                {/* 分类标题骨架 */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-zinc-900 to-black rounded-lg animate-pulse" />
                  <div className="h-8 bg-gradient-to-r from-zinc-900 to-zinc-900/50 rounded-lg w-48 animate-pulse" />
                </div>
                
                {/* 影片卡片骨架 */}
                <div className="flex space-x-4 overflow-hidden">
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <div key={j} className="flex-shrink-0 w-48 md:w-56">
                      {/* 海报骨架 */}
                      <div className="relative aspect-[2/3] bg-gradient-to-br from-zinc-950 via-black to-zinc-950 rounded-lg overflow-hidden">
                        <div className="absolute inset-0 animate-pulse bg-gradient-to-tr from-transparent via-white/5 to-transparent" />
                      </div>
                      {/* 标题骨架 */}
                      <div className="h-6 bg-gradient-to-r from-zinc-900 to-zinc-900/50 rounded-lg w-3/4 mt-2 animate-pulse" />
                      {/* 评分骨架 */}
                      <div className="h-4 bg-gradient-to-r from-zinc-900 to-zinc-900/30 rounded-lg w-1/2 mt-1 animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        /* 错误状态 */
        <div className="h-screen flex items-center justify-center">
          <div className="text-center px-4 max-w-md">
            <div className="w-24 h-24 mx-auto mb-6 bg-red-900/20 rounded-full flex items-center justify-center">
              <svg
                className="w-12 h-12 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              糟糕，出了点问题
            </h2>
            <p className="text-gray-400 mb-6 text-sm">{error}</p>
            <button
              onClick={fetchData}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors shadow-lg"
            >
              重试
            </button>
          </div>
        </div>
      ) : categories.length === 0 && top250Movies.length === 0 ? (
        /* 空状态 */
        <div className="h-screen flex items-center justify-center">
          <div className="text-center px-4 max-w-md">
            <div className="w-24 h-24 mx-auto mb-6 bg-gray-800 rounded-full flex items-center justify-center">
              <svg
                className="w-12 h-12 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">暂无内容</h2>
            <p className="text-gray-400 mb-6 text-sm">当前没有可显示的内容</p>
            <button
              onClick={fetchData}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
            >
              刷新
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Hero Banner - 轮播海报 */}
          {heroMovies.length > 0 && heroDataList.length > 0 ? (
            <div className="relative w-full group">
              {/* 海报容器 - 使用固定宽高比 */}
              <div className="relative w-full aspect-[3/4] md:aspect-[12/5] overflow-hidden">
                {/* 轮播图片 */}
                {heroMovies.map((movie, index) => {
                  const heroData = heroDataList[index];
                  const isActive = index === currentHeroIndex;
                  
                  return (
                    <div
                      key={movie.id}
                      className={`absolute inset-0 transition-opacity duration-700 ${
                        isActive ? 'opacity-100 z-10' : 'opacity-0 z-0'
                      }`}
                    >
                      {/* 移动端：9:16 竖向海报 */}
                      <img
                        src={getImageUrl(heroData.poster_vertical)}
                        alt={movie.title}
                        className="block md:hidden absolute inset-0 w-full h-full object-cover bg-black"
                      />

                      {/* PC端：16:9 横向海报 */}
                      <img
                        src={getImageUrl(heroData.poster_horizontal)}
                        alt={movie.title}
                        className="hidden md:block absolute inset-0 w-full h-full object-cover bg-black"
                      />
 
                      {/* 渐变遮罩 */}
                      <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-black/95 via-black/70 md:via-black/50 to-transparent" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />

                      {/* 内容 */}
                      <div className="absolute inset-0 flex items-end">
                        <div className="w-full px-4 md:px-12 pb-8 md:pb-12 lg:pb-16">
                          <div className="max-w-3xl">
                            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-3 md:mb-4 leading-tight drop-shadow-2xl">
                              {movie.title}
                            </h1>

                            {/* 评分、类型和剧集信息 */}
                            <div className="flex flex-wrap items-center gap-2 mb-3 md:mb-4">
                              {movie.rate && (
                                <div className="flex items-center space-x-1 text-yellow-400 bg-black/40 px-2.5 py-1 rounded-full backdrop-blur-sm">
                                  <svg
                                    className="w-4 h-4"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                  </svg>
                                  <span className="font-bold text-sm">
                                    {movie.rate}
                                  </span>
                                </div>
                              )}

                              {heroData.genres && heroData.genres.length > 0 && (
                                <>
                                  {heroData.genres.slice(0, 3).map((genre: string, idx: number) => (
                                    <span
                                      key={idx}
                                      className="text-xs text-gray-200 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm"
                                    >
                                      {genre}
                                    </span>
                                  ))}
                                </>
                              )}

                              {movie.episode_info && (
                                <span className="text-xs text-gray-200 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm">
                                  {movie.episode_info}
                                </span>
                              )}
                            </div>

                            {/* 电影描述 - 仅PC端显示 */}
                            {heroData.description && (
                              <p className="hidden md:block text-sm text-gray-200 mb-4 line-clamp-2 leading-relaxed max-w-2xl">
                                {heroData.description}
                              </p>
                            )}

                            {/* 操作按钮 */}
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleMovieClick(movie)}
                                className="flex items-center gap-2 bg-white text-black px-6 md:px-8 py-3 md:py-3.5 rounded-lg font-bold hover:bg-opacity-90 hover:scale-105 transition-all duration-200 text-sm md:text-base shadow-2xl"
                              >
                                <Play className="w-5 h-5 md:w-6 md:h-6 fill-current" />
                                <span>立即播放</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* 左右导航按钮 - 仅悬停时显示 */}
                <button
                  onClick={goToPrevHero}
                  className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-sm transition-all duration-300 hover:scale-110 opacity-0 group-hover:opacity-100"
                  aria-label="上一个"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  onClick={goToNextHero}
                  className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-sm transition-all duration-300 hover:scale-110 opacity-0 group-hover:opacity-100"
                  aria-label="下一个"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>

                {/* 指示器 */}
                <div className="absolute hidden md:flex bottom-6 left-1/2 -translate-x-1/2 z-20 items-center gap-2">
                  {heroMovies.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => goToHero(index)}
                      className={`transition-all duration-300 ${
                        index === currentHeroIndex
                          ? 'w-8 h-2 bg-white'
                          : 'w-2 h-2 bg-white/50 hover:bg-white/75'
                      } rounded-full`}
                      aria-label={`跳转到第 ${index + 1} 个`}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Hero 骨架屏 - 使用固定宽高比 */
            <div className="relative w-full aspect-[9/16] md:aspect-[16/9] overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-black animate-pulse">
              {/* 渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-black/95 via-black/70 md:via-black/50 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
              
              {/* 内容骨架 */}
              <div className="absolute inset-0 flex items-end">
                <div className="w-full px-4 md:px-12 pb-8 md:pb-12 lg:pb-16">
                  <div className="max-w-3xl space-y-4">
                    {/* 标题骨架 */}
                    <div className="h-12 md:h-16 bg-gray-700/50 rounded-lg w-3/4 animate-pulse" />
                    
                    {/* 标签骨架 */}
                    <div className="flex gap-2">
                      <div className="h-6 w-16 bg-gray-700/50 rounded-full animate-pulse" />
                      <div className="h-6 w-20 bg-gray-700/50 rounded-full animate-pulse" />
                      <div className="h-6 w-24 bg-gray-700/50 rounded-full animate-pulse" />
                    </div>
                    
                    {/* 描述骨架 */}
                    <div className="hidden md:block space-y-2">
                      <div className="h-4 bg-gray-700/50 rounded w-full animate-pulse" />
                      <div className="h-4 bg-gray-700/50 rounded w-5/6 animate-pulse" />
                    </div>
                    
                    {/* 按钮骨架 */}
                    <div className="h-12 w-36 bg-gray-700/50 rounded-lg animate-pulse" />
                  </div>
                </div>
              </div>
              
              {/* 指示器骨架 */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-2 h-2 bg-gray-700/50 rounded-full animate-pulse" />
                ))}
              </div>
            </div>
          )}

          {/* 分类列表区域 */}
          <div className="relative z-20 mt-6 sm:-mt-4 md:-mt-4 lg:-mt-4 space-y-10 md:space-y-12 lg:space-y-16 pb-16">
            {/* 渲染所有新 API 返回的分类 */}
            {categories.length > 0 ? (
              categories.map((category, index) => {
                // 转换数据格式为 DoubanMovie
                const movies: DoubanMovie[] = category.data.map(
                  (item: NewApiMovie) => ({
                    id: item.id,
                    title: item.title,
                    cover: item.cover || "",
                    url: item.url || "",
                    rate: item.rate || "",
                    episode_info: (item.episode_info as string) || "",
                    cover_x: (item.cover_x as number) || 0,
                    cover_y: (item.cover_y as number) || 0,
                    playable: (item.playable as boolean) || false,
                    is_new: (item.is_new as boolean) || false,
                  })
                );

                return (
                  <CategoryRow
                    key={index}
                    title={category.name}
                    icon={getCategoryIcon(category.name)}
                    movies={movies}
                    onMovieClick={handleMovieClick}
                    onViewMore={() =>
                      router.push(`/category/${getCategoryPath(category.name)}`)
                    }
                  />
                );
              })
            ) : (
              /* 分类占位符 */
              <div className="px-4 md:px-12 text-center py-12">
                <div className="inline-flex items-center space-x-2 text-gray-500 bg-gray-900/50 px-6 py-4 rounded-lg">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                  <span>暂无可用分类</span>
                </div>
              </div>
            )}

            {/* 豆瓣 Top 250 - 保留 */}
            {top250Movies.length > 0 && (
              <CategoryRow
                title="豆瓣 Top 250"
                icon={<Star className="w-5 h-5 fill-current text-yellow-500" />}
                movies={top250Movies}
                onMovieClick={handleMovieClick}
                onViewMore={() => router.push("/category/top250")}
              />
            )}
          </div>
        </>
      )}

      {/* 匹配中遮罩 */}
      {matchingMovie && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-700 border-t-red-600 mx-auto mb-4" />
            <p className="text-white text-lg font-medium">正在为你寻找播放源</p>
            <p className="text-gray-400 text-sm mt-2">搜索中，请稍候...</p>
          </div>
        </div>
      )}
      {/* Toast 通知 */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Footer */}
      <footer className="mt-20 border-t border-gray-800 bg-gradient-to-b from-black to-gray-950">
        <div className="mx-auto px-4 md:px-12 py-12">
          {/* 免责声明 */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              免责声明
            </h3>
            <div className="space-y-3 text-sm text-gray-400 leading-relaxed">
              <p>
                本站为<span className="text-white font-medium">技术学习和交流平台</span>，仅提供影视信息检索和导航服务。所有视频资源均来自互联网公开资源，本站不存储任何影视文件。
              </p>
              <p>
                本站提供的所有链接和资源均来自第三方网站，其版权归原作者及原网站所有。如果您认为本站侵犯了您的版权或权益，请联系我们，我们会及时删除相关内容。
              </p>
              <p>
                本站尊重知识产权，支持正版影视。我们<span className="text-white font-medium">强烈建议用户通过正规渠道</span>（如爱奇艺、腾讯视频、优酷等）观看影视内容，以支持影视创作者。
              </p>
              <p className="text-xs text-gray-500 mt-4">
                使用本站服务即表示您同意遵守相关法律法规，并自行承担使用本站服务可能产生的风险和责任。
              </p>
            </div>
          </div>

          {/* 分隔线 */}
          <div className="border-t border-gray-800 my-8"></div>

          {/* 底部信息 */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <span>© 2025 壳儿</span>
              <span className="text-gray-700">|</span>
              <span>仅供学习交流使用</span>
            </div>
            
            <div className="flex items-center gap-6">
              <a 
                href="https://github.com/unilei/kerkerker" 
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-300 transition-colors flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
                GitHub
              </a>
              <button 
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="hover:text-gray-300 transition-colors flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                回到顶部
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// 分类行组件
interface CategoryRowProps {
  title: string;
  icon: React.JSX.Element;
  movies: DoubanMovie[];
  onMovieClick: (movie: DoubanMovie) => void;
  onViewMore: () => void;
}

function CategoryRow({
  title,
  icon,
  movies,
  onMovieClick,
  onViewMore,
}: CategoryRowProps) {
  const INITIAL_DISPLAY_COUNT = 15;
  const displayMovies = movies.slice(0, INITIAL_DISPLAY_COUNT);
  const hasMore = movies.length > INITIAL_DISPLAY_COUNT;

  return (
    <div className="px-4 md:px-12">
      {/* 标题和查看更多 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-3">
          {icon}
          <span>{title}</span>
        </h2>
        {hasMore && (
          <button
            onClick={onViewMore}
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center space-x-1 group"
          >
            <span>查看全部</span>
            <svg
              className="w-4 h-4 group-hover:translate-x-1 transition-transform"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        )}
      </div>

      {/* 横向滚动列表 */}
      <div className="relative group">
        <div className="flex overflow-x-auto space-x-3 md:space-x-4 pb-4 scrollbar-hide scroll-smooth">
          {displayMovies.map((movie) => (
            <div key={movie.id} className="flex-shrink-0 w-40 sm:w-48 md:w-56">
              <DoubanCard movie={movie} onSelect={onMovieClick} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
