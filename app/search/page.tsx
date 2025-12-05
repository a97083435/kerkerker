'use client';

import { useState, useEffect, useCallback, Suspense, useTransition, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Drama } from '@/types/drama';
import { VodSource } from '@/types/drama';

// 缓存键
const SEARCH_CACHE_KEY = 'search_results_cache';

// 缓存数据结构
interface SearchCache {
  keyword: string;
  results: (Drama & { source: VodSource })[];
  stats: { total: number; bySource: Record<string, number> };
  sources: VodSource[];
  timestamp: number;
}

// 安全存储缓存
function saveSearchCache(data: SearchCache): void {
  try {
    const json = JSON.stringify(data);
    // 超过 5MB 不缓存
    if (json.length > 5 * 1024 * 1024) {
      console.log('搜索结果超过 5MB，跳过缓存');
      return;
    }
    sessionStorage.setItem(SEARCH_CACHE_KEY, json);
    console.log(`💾 搜索结果已缓存: ${data.results.length} 条`);
  } catch (e) {
    // 存储失败，静默降级
    console.warn('缓存存储失败:', e);
  }
}

// 读取缓存
function loadSearchCache(keyword: string): SearchCache | null {
  try {
    const cached = sessionStorage.getItem(SEARCH_CACHE_KEY);
    if (!cached) return null;
    
    const data: SearchCache = JSON.parse(cached);
    
    // 检查关键词是否匹配
    if (data.keyword !== keyword) return null;
    
    // 检查缓存是否过期（30分钟）
    if (Date.now() - data.timestamp > 30 * 60 * 1000) {
      sessionStorage.removeItem(SEARCH_CACHE_KEY);
      return null;
    }
    
    console.log(`📦 使用缓存的搜索结果: ${data.results.length} 条`);
    return data;
  } catch {
    return null;
  }
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryKeyword = searchParams.get('q') || '';
  
  const [searchKeyword, setSearchKeyword] = useState(queryKeyword);
  const [searchResults, setSearchResults] = useState<(Drama & { source: VodSource })[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [allSources, setAllSources] = useState<VodSource[]>([]);
  const [currentSource, setCurrentSource] = useState<VodSource | null>(null);
  const [searchStats, setSearchStats] = useState<{ total: number; bySource: Record<string, number> }>({ total: 0, bySource: {} });
  
  // 流式搜索进度
  const [searchProgress, setSearchProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 });
  
  // 使用 useTransition 让渲染不阻塞用户交互
  const [isPending, startTransition] = useTransition();
  
  // 防止重复搜索
  const searchingRef = useRef<string | null>(null);
  
  // 同步 URL 参数到本地搜索框状态
  useEffect(() => {
    setSearchKeyword(queryKeyword);
  }, [queryKeyword]);
  
  // 执行流式搜索 - 每个源完成就立即显示结果
  const performSearch = useCallback(async (keyword: string) => {
    if (!keyword.trim()) return;
    
    setLoading(true);
    setSearched(true);
    setSearchResults([]);
    setSearchStats({ total: 0, bySource: {} });
    setSearchProgress({ completed: 0, total: 0 });
    
    try {
      console.log(`🔍 开始流式搜索: ${keyword}`);
      
      // 使用流式搜索 API
      const response = await fetch(`/api/drama/search-stream?q=${encodeURIComponent(keyword.trim())}`);
      
      if (!response.ok) {
        throw new Error('搜索请求失败');
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // 解析 SSE 数据
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // 保留未完成的部分
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'init') {
                // 初始化：设置总源数和源列表
                console.log(`📡 开始搜索 ${data.totalSources} 个视频源`);
                setSearchProgress({ completed: 0, total: data.totalSources });
                setAllSources(data.sources.map((s: { key: string; name: string }) => ({ 
                  key: s.key, 
                  name: s.name,
                  api: '' // API URL 不需要在前端
                })));
              } else if (data.type === 'result') {
                // 收到单个源的结果 - 立即追加显示
                console.log(`  ✅ ${data.sourceName} 找到 ${data.count} 个结果`);
                
                startTransition(() => {
                  setSearchResults(prev => [...prev, ...data.results]);
                  setSearchStats(prev => ({
                    total: prev.total + data.count,
                    bySource: {
                      ...prev.bySource,
                      [data.sourceKey]: data.count,
                    },
                  }));
                });
                
                setSearchProgress(prev => ({ 
                  ...prev, 
                  completed: prev.completed + 1 
                }));
              } else if (data.type === 'done') {
                console.log('📊 所有视频源搜索完成');
                
                // 搜索完成后缓存结果
                setSearchResults(currentResults => {
                  setSearchStats(currentStats => {
                    setAllSources(currentSources => {
                      saveSearchCache({
                        keyword,
                        results: currentResults,
                        stats: currentStats,
                        sources: currentSources,
                        timestamp: Date.now(),
                      });
                      return currentSources;
                    });
                    return currentStats;
                  });
                  return currentResults;
                });
              }
            } catch (e) {
              console.error('解析 SSE 数据失败:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, [startTransition]);

  // 从数据库加载视频源配置
  useEffect(() => {
    const loadSources = async () => {
      try {
        const response = await fetch('/api/vod-sources');
        const result = await response.json();
        
        if (result.code === 200 && result.data) {
          setAllSources(result.data.sources || []);
          setCurrentSource(result.data.selected || null);
        }
      } catch (error) {
        console.error('加载视频源配置失败:', error);
      }
    };
    
    loadSources();
  }, []);

  // 当搜索关键词变化时执行搜索
  useEffect(() => {
    if (queryKeyword && searchingRef.current !== queryKeyword) {
      searchingRef.current = queryKeyword;
      
      // 先检查缓存
      const cached = loadSearchCache(queryKeyword);
      if (cached) {
        // 使用缓存结果
        setSearchResults(cached.results);
        setSearchStats(cached.stats);
        setAllSources(cached.sources);
        setSearchProgress({ completed: cached.sources.length, total: cached.sources.length });
        setSearched(true);
        setLoading(false);
        return;
      }
      
      // 无缓存，执行搜索
      performSearch(queryKeyword);
    }
  }, [queryKeyword, performSearch]);

  // 处理搜索提交
  const handleSearch = () => {
    if (!searchKeyword.trim()) return;
    router.push(`/search?q=${encodeURIComponent(searchKeyword.trim())}`);
  };

  // 点击影片 - 直接跳转播放页面
  const handlePlayClick = (drama: Drama & { source: VodSource }) => {
    router.push(`/play/${drama.id}?source=${drama.source.key}`);
  };

  // 返回首页
  const goBack = () => {
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* 顶部导航栏 */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-md border-b border-gray-800/50">
        <div className="px-4 md:px-12 py-3 md:py-4">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            {/* 返回按钮 */}
            <button
              onClick={goBack}
              className="flex items-center space-x-1 md:space-x-2 text-white hover:text-gray-300 transition-colors group"
            >
              <svg className="w-5 h-5 md:w-6 md:h-6 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-xs md:text-sm font-medium">返回</span>
            </button>

            {/* Logo */}
            <h1 className="text-red-600 text-xl md:text-2xl font-bold tracking-tight cursor-pointer hover:text-red-500 transition-colors" onClick={goBack}>
              壳儿
            </h1>
          </div>

          {/* 搜索框 */}
          <div className="flex items-center space-x-2 md:space-x-3">
            <div className="flex-1 max-w-4xl">
              <div className="flex items-center bg-gray-900/80 border border-gray-700/50 rounded-lg overflow-hidden focus-within:border-red-600 focus-within:bg-gray-900 transition-all shadow-lg">
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="搜索电影、电视剧、动漫..."
                  className="flex-1 bg-transparent px-4 md:px-6 py-2.5 md:py-3 text-sm md:text-base outline-none placeholder-gray-500"
                  autoFocus
                />
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  className="px-4 md:px-6 py-2.5 md:py-3 bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 播放源筛选器 */}
            {allSources.length > 0 && searchResults.length > 0 ? (
              <select
                value={currentSource?.key || 'all'}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'all') {
                    setCurrentSource(null);
                  } else {
                    const selectedSource = allSources.find(s => s.key === value);
                    setCurrentSource(selectedSource || null);
                  }
                }}
                className="bg-gray-900/80 border border-gray-700/50 rounded-lg px-3 md:px-4 py-2.5 md:py-3 text-xs md:text-sm outline-none hover:border-gray-600 hover:bg-gray-900 transition-all cursor-pointer shadow-lg"
              >
                <option value="all">全部源 ({searchResults.length})</option>
                {allSources.map(source => {
                  const count = searchStats.bySource[source.key] || 0;
                  return (
                    <option key={source.key} value={source.key}>
                      {source.name} ({count})
                    </option>
                  );
                })}
              </select>
            ) : allSources.length === 0 ? (
              <div className="bg-red-500/10 border border-red-500/50 rounded-lg px-4 py-2.5 text-xs md:text-sm text-red-400">
                未配置视频源
              </div>
            ) : null}
          </div>
        </div>
      </nav>

      {/* 内容区域 */}
      <div className="pt-32 md:pt-36 lg:pt-40 px-4 md:px-12 pb-12">
        {allSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="text-center">
              <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center mb-6 mx-auto">
                <svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl md:text-2xl font-bold text-white mb-2">未配置视频源</h3>
              <p className="text-gray-400 mb-6">请先在后台管理中配置视频源后再使用搜索功能</p>
              <a
                href="/admin/settings"
                className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              >
                前往配置
              </a>
            </div>
          </div>
        ) : (loading && searchResults.length === 0) ? (
          /* 初始加载状态 - 还没有任何结果 */
          <div className="flex items-center justify-center py-24 md:py-32">
            <div className="text-center animate-fade-in">
              <div className="animate-spin rounded-full h-12 w-12 md:h-16 md:w-16 border-4 border-gray-700 border-t-red-600 mx-auto mb-4" />
              <p className="text-gray-300 text-base md:text-lg font-medium">正在搜索视频源...</p>
              {searchProgress.total > 0 && (
                <p className="text-gray-500 text-xs md:text-sm mt-2">
                  已完成 {searchProgress.completed}/{searchProgress.total} 个源
                </p>
              )}
            </div>
          </div>
        ) : searched || searchResults.length > 0 ? (
          searchResults.length > 0 ? (
            <div className="animate-fade-in">
              <div className="mb-6 md:mb-8">
                <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-white mb-2 flex items-center gap-3">
                  搜索结果
                  {/* 搜索进行中指示器 */}
                  {loading && (
                    <span className="inline-flex items-center gap-2 text-sm font-normal text-gray-400 bg-gray-800/50 px-3 py-1 rounded-full">
                      <span className="w-3 h-3 border-2 border-gray-600 border-t-red-500 rounded-full animate-spin" />
                      {searchProgress.completed}/{searchProgress.total}
                    </span>
                  )}
                  {isPending && !loading && (
                    <span className="inline-flex items-center gap-2 text-sm font-normal text-gray-400">
                      <span className="w-4 h-4 border-2 border-gray-600 border-t-red-500 rounded-full animate-spin" />
                      渲染中...
                    </span>
                  )}
                </h2>
                <p className="text-gray-400 text-xs md:text-sm mb-2">
                  {loading ? (
                    <>正在搜索 <span className="text-red-500 font-semibold">{searchProgress.total} 个视频源</span>，已找到 <span className="text-white font-semibold">{searchResults.length}</span> 个结果</>
                  ) : (
                    <>在 <span className="text-red-500 font-semibold">{searchProgress.total || allSources.length} 个视频源</span> 中找到 <span className="text-white font-semibold">{searchResults.length}</span> 个结果</>
                  )}
                  {queryKeyword && <> · 关键词: <span className="text-white font-medium">&ldquo;{queryKeyword}&rdquo;</span></>}
                </p>
                {/* 各源结果统计 */}
                {searchStats.total > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {Object.entries(searchStats.bySource).map(([sourceKey, count]) => {
                      const source = allSources.find(s => s.key === sourceKey);
                      return (
                        <span key={sourceKey} className="text-xs bg-gray-800/50 px-2 py-1 rounded">
                          {source?.name}: <span className="text-white font-medium">{count}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 md:gap-4 lg:gap-5">
                {searchResults
                  .filter(drama => !currentSource || drama.source.key === currentSource.key)
                  .map((drama, index) => (
                  <div
                    key={`${drama.source.key}-${drama.id}-${index}`}
                    onClick={() => handlePlayClick(drama)}
                    className="group cursor-pointer transition-all duration-300 hover:scale-105 hover:z-10"
                  >
                    {/* 封面 */}
                    <div className="relative aspect-2/3 bg-gray-900 rounded-lg overflow-hidden mb-2 md:mb-3 shadow-lg group-hover:shadow-2xl transition-shadow">
                      {drama.pic ? (
                        <img
                          src={drama.pic}
                          alt={drama.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                          <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      
                      {/* 悬停遮罩 */}
                      <div className="absolute inset-0 bg-linear-to-t from-black via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
                        <div className="text-center transform scale-75 group-hover:scale-100 transition-transform duration-300">
                          <div className="w-12 h-12 md:w-14 md:h-14 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mb-2 mx-auto border-2 border-white/30">
                            <svg className="w-6 h-6 md:w-7 md:h-7 text-white ml-1" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                            </svg>
                          </div>
                          <p className="text-white text-xs md:text-sm font-bold drop-shadow-lg">立即播放</p>
                        </div>
                      </div>

                      {/* 标签 */}
                      <div className="absolute top-2 left-2 right-2 flex justify-between items-start gap-1">
                        {/* 视频源标签 */}
                        <div className="bg-blue-600/90 backdrop-blur-sm text-white text-xs px-2 py-1 rounded shadow-lg">
                          {drama.source.name}
                        </div>
                        {/* 更新标签 */}
                        {drama.remarks && (
                          <div className="bg-red-600/90 backdrop-blur-sm text-white text-xs px-2 py-1 rounded shadow-lg">
                            {drama.remarks}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 信息 */}
                    <div>
                      <h3 className="text-white font-semibold text-xs md:text-sm mb-1 line-clamp-2 group-hover:text-red-400 transition-colors leading-tight">
                        {drama.name}
                      </h3>
                      <div className="flex items-center space-x-1.5 md:space-x-2 text-[10px] md:text-xs text-gray-400">
                        {drama.year && <span>{drama.year}</span>}
                        {drama.area && (
                          <>
                            <span>•</span>
                            <span>{drama.area}</span>
                          </>
                        )}
                      </div>
                      {drama.score && parseFloat(drama.score) > 0 && (
                        <div className="flex items-center mt-1">
                          <svg className="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          <span className="text-yellow-500 text-xs ml-1 font-medium">{drama.score}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* 无结果 */
            <div className="flex flex-col items-center justify-center py-32">
              <div className="w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center mb-6">
                <svg className="w-12 h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">未找到相关内容</h3>
              <p className="text-gray-400 mb-2">
                在所有 {allSources.length} 个视频源中搜索 &ldquo;{queryKeyword}&rdquo; 没有结果
              </p>
              <p className="text-gray-500 text-sm mb-6">
                已搜索: {allSources.map(s => s.name).join('、')}
              </p>
              <div className="flex items-center space-x-4">
                <button
                  onClick={goBack}
                  className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  返回首页
                </button>
                <button
                  onClick={() => setSearchKeyword('')}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  重新搜索
                </button>
              </div>
            </div>
          )
        ) : (
          /* 初始状态 */
          <div className="flex flex-col items-center justify-center py-32">
            <div className="w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center mb-6">
              <svg className="w-12 h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">搜索影视资源</h3>
            <p className="text-gray-400 mb-2">
              输入关键词，将在 {allSources.length} 个视频源中搜索
            </p>
            <p className="text-gray-500 text-sm">
              {allSources.map(s => s.name).join('、')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-700 border-t-red-600 mx-auto mb-4" />
          <p className="text-gray-300 text-lg font-medium">加载中...</p>
        </div>
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}
