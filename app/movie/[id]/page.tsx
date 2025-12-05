"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Play, Star, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { getImageUrl } from "@/lib/utils/image-utils";
import { loadMovieCache, MovieCacheData } from "@/hooks/useMovieMatch";

interface AvailableSource {
  source_key: string;
  source_name: string;
  vod_id: string | number;
  vod_name: string;
  match_confidence: "high" | "medium" | "low";
}

interface CachedMatchData {
  douban_id: string;
  title: string;
  matches: AvailableSource[];
  timestamp: number;
}

type SearchStatus = "idle" | "searching" | "success" | "error" | "not_found";

// 在组件外部读取缓存的函数（避免 SSR 问题）
function getInitialMovieData(doubanId: string): MovieCacheData | null {
  if (typeof window === 'undefined') return null;
  return loadMovieCache(doubanId);
}

export default function MovieDetailPage() {
  const params = useParams();
  const router = useRouter();
  
  const doubanId = params.id as string;
  
  // 使用函数初始化状态，避免 useEffect 中的 setState
  const [movieData] = useState<MovieCacheData | null>(() => getInitialMovieData(doubanId));
  
  // 电影基本信息
  const title = movieData?.title || "";
  const cover = movieData?.cover || "";
  const rate = movieData?.rate || "";
  const episodeInfo = movieData?.episode_info || "";

  // 搜索状态
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [searchedSourceCount, setSearchedSourceCount] = useState<number>(0);
  const [totalSourceCount, setTotalSourceCount] = useState<number>(0);

  // 流式搜索播放源 - 每个源完成立即显示
  const searchPlaySources = useCallback(async (forceRefresh = false) => {
    // 检查缓存
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem("multi_source_matches");
        if (cached) {
          const data: CachedMatchData = JSON.parse(cached);
          // 缓存有效期 30 分钟，且是同一部影片
          if (
            data.douban_id === doubanId &&
            Date.now() - data.timestamp < 30 * 60 * 1000 &&
            data.matches.length > 0
          ) {
            setAvailableSources(data.matches);
            setSearchStatus("success");
            return;
          }
        }
      } catch {
        // 缓存读取失败，继续搜索
      }
    }

    // 开始流式搜索
    setSearchStatus("searching");
    setErrorMessage("");
    setAvailableSources([]);
    setSearchedSourceCount(0);
    setTotalSourceCount(0);

    try {
      const response = await fetch(
        `/api/douban/match-vod-stream?title=${encodeURIComponent(title)}&douban_id=${doubanId}`
      );

      if (!response.ok) {
        throw new Error('搜索请求失败');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      const allMatches: AvailableSource[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 数据
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'init') {
                setTotalSourceCount(data.totalSources);
              } else if (data.type === 'result') {
                setSearchedSourceCount(data.completed);
                
                // 如果找到匹配，立即添加到列表
                if (data.match) {
                  allMatches.push(data.match);
                  // 按置信度排序：high > medium > low
                  const sorted = [...allMatches].sort((a, b) => {
                    const order = { high: 3, medium: 2, low: 1 };
                    return order[b.match_confidence] - order[a.match_confidence];
                  });
                  setAvailableSources(sorted);
                  
                  // 只要找到第一个源，就切换到 success 状态
                  if (allMatches.length === 1) {
                    setSearchStatus("success");
                  }
                }
              } else if (data.type === 'done') {
                // 搜索完成，缓存结果
                if (allMatches.length > 0) {
                  localStorage.setItem(
                    "multi_source_matches",
                    JSON.stringify({
                      douban_id: doubanId,
                      title: title,
                      matches: allMatches,
                      timestamp: Date.now(),
                    })
                  );
                } else {
                  setSearchStatus("not_found");
                  setErrorMessage(`已搜索 ${data.totalSources} 个视频源，未找到匹配内容`);
                }
              }
            } catch (e) {
              console.error('解析 SSE 数据失败:', e);
            }
          }
        }
      }
    } catch (error) {
      setSearchStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "搜索播放源时出错");
    }
  }, [doubanId, title]);

  // 组件挂载时自动搜索
  useEffect(() => {
    let isMounted = true;
    
    const doSearch = async () => {
      if (doubanId && title && isMounted) {
        await searchPlaySources();
      }
    };
    
    doSearch();
    
    return () => {
      isMounted = false;
    };
  }, [doubanId, title, searchPlaySources]);

  // 播放
  const handlePlay = (source: AvailableSource) => {
    router.push(`/play/${source.vod_id}?source=${source.source_key}&multi=true`);
  };

  // 快速播放（使用第一个源）
  const handleQuickPlay = () => {
    if (availableSources.length > 0) {
      handlePlay(availableSources[0]);
    }
  };

  return (
    <div className="min-h-screen bg-black">
      {/* 背景图 */}
      <div className="fixed inset-0 z-0">
        <img
          src={getImageUrl(cover)}
          alt={title}
          className="w-full h-full object-cover opacity-20 blur-2xl scale-110"
        />
        <div className="absolute inset-0 bg-linear-to-t from-black via-black/80 to-black/60" />
      </div>

      {/* 顶部导航 */}
      <nav className="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center">
          <Link
            href="/"
            className="flex items-center gap-2 text-white hover:text-red-500 transition-colors group"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            <span>返回首页</span>
          </Link>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="relative z-10 max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row gap-8">
          {/* 海报 */}
          <div className="shrink-0 w-full md:w-72 lg:w-80">
            <div className="aspect-2/3 rounded-xl overflow-hidden shadow-2xl shadow-black/50">
              <img
                src={getImageUrl(cover)}
                alt={title}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* 信息区域 */}
          <div className="flex-1 space-y-6">
            {/* 标题 */}
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight">
              {title}
            </h1>

            {/* 元信息 */}
            <div className="flex flex-wrap items-center gap-3">
              {rate && (
                <div className="flex items-center gap-1.5 text-yellow-400 bg-yellow-400/10 px-3 py-1.5 rounded-lg">
                  <Star className="w-5 h-5 fill-current" />
                  <span className="font-bold text-lg">{rate}</span>
                </div>
              )}
              {episodeInfo && (
                <span className="text-gray-300 bg-white/10 px-3 py-1.5 rounded-lg text-sm">
                  {episodeInfo}
                </span>
              )}
            </div>

            {/* 播放源区域 */}
            <div className="pt-6 border-t border-white/10">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                播放源
                {searchStatus === "searching" && totalSourceCount > 0 && (
                  <span className="text-sm font-normal text-gray-400">
                    ({searchedSourceCount}/{totalSourceCount})
                  </span>
                )}
              </h2>

              {/* 搜索中但还没找到源 */}
              {searchStatus === "searching" && availableSources.length === 0 && (
                <div className="flex items-center gap-3 text-gray-400 py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>正在搜索可用播放源... {searchedSourceCount > 0 && `(${searchedSourceCount}/${totalSourceCount})`}</span>
                </div>
              )}

              {/* 搜索成功或搜索中已找到源 */}
              {(searchStatus === "success" || (searchStatus === "searching" && availableSources.length > 0)) && (
                <div className="space-y-4">
                  {/* 快速播放按钮 */}
                  <button
                    onClick={handleQuickPlay}
                    className="w-full md:w-auto flex items-center justify-center gap-3 bg-red-600 hover:bg-red-500 text-white px-8 py-4 rounded-xl font-bold text-lg transition-all hover:scale-105 shadow-lg shadow-red-600/30"
                  >
                    <Play className="w-6 h-6 fill-current" />
                    <span>立即播放</span>
                  </button>

                  {/* 播放源列表 */}
                  <div className="mt-6">
                    <p className="text-sm text-gray-400 mb-3 flex items-center gap-2">
                      {searchStatus === "searching" ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>搜索中 {searchedSourceCount}/{totalSourceCount}，已找到 {availableSources.length} 个可用</span>
                        </>
                      ) : (
                        <span>已搜索 {totalSourceCount || searchedSourceCount} 个源，找到 {availableSources.length} 个可用</span>
                      )}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {availableSources.map((source, index) => (
                        <button
                          key={`${source.source_key}-${source.vod_id}`}
                          onClick={() => handlePlay(source)}
                          className={`relative p-4 rounded-lg text-left transition-all hover:scale-105 ${
                            index === 0
                              ? "bg-red-600/20 border border-red-500/50 hover:bg-red-600/30"
                              : "bg-white/5 border border-white/10 hover:bg-white/10"
                          }`}
                        >
                          <div className="font-medium text-white text-sm">
                            {source.source_name}
                          </div>
                          <div className="text-xs text-gray-400 mt-1 truncate">
                            {source.vod_name}
                          </div>
                          {source.match_confidence === "high" && (
                            <span className="absolute top-2 right-2 text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
                              精确
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 未找到 */}
              {searchStatus === "not_found" && (
                <div className="text-center py-8 space-y-4">
                  <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto">
                    <AlertCircle className="w-8 h-8 text-yellow-500" />
                  </div>
                  <p className="text-gray-400">{errorMessage}</p>
                  <button
                    onClick={() => searchPlaySources(true)}
                    className="inline-flex items-center gap-2 text-red-500 hover:text-red-400 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>重新搜索</span>
                  </button>
                </div>
              )}

              {/* 搜索出错 */}
              {searchStatus === "error" && (
                <div className="text-center py-8 space-y-4">
                  <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
                    <AlertCircle className="w-8 h-8 text-red-500" />
                  </div>
                  <p className="text-gray-400">{errorMessage}</p>
                  <button
                    onClick={() => searchPlaySources(true)}
                    className="inline-flex items-center gap-2 text-red-500 hover:text-red-400 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>重试</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
