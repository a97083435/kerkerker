import { getDatabase } from './db';
import { VodSource } from '@/types/drama';

export interface VodSourceDoc {
  _id?: string;
  key: string;
  name: string;
  api: string;
  play_url: string;
  type: string;
  enabled: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

// 将数据库文档转换为 VodSource 类型
function docToVodSource(doc: VodSourceDoc): VodSource {
  return {
    key: doc.key,
    name: doc.name,
    api: doc.api,
    playUrl: doc.play_url,
    type: doc.type as 'json' | 'xml',
  };
}

// 获取所有启用的视频源
export async function getVodSourcesFromDB(): Promise<VodSource[]> {
  const db = await getDatabase();
  const collection = db.collection<VodSourceDoc>('vod_sources');
  
  const docs = await collection
    .find({ enabled: true })
    .sort({ sort_order: 1, _id: 1 })
    .toArray();
  
  return docs.map(docToVodSource);
}

// 获取所有视频源（包括禁用的）
export async function getAllVodSourcesFromDB(): Promise<VodSourceDoc[]> {
  const db = await getDatabase();
  const collection = db.collection<VodSourceDoc>('vod_sources');
  
  const docs = await collection
    .find()
    .sort({ sort_order: 1, _id: 1 })
    .toArray();
  
  return docs;
}

// 添加或更新视频源
export async function saveVodSourceToDB(source: VodSource & { enabled?: boolean; sortOrder?: number }) {
  const db = await getDatabase();
  const collection = db.collection<VodSourceDoc>('vod_sources');
  const now = Math.floor(Date.now() / 1000);
  
  const doc: VodSourceDoc = {
    key: source.key,
    name: source.name,
    api: source.api,
    play_url: source.playUrl,
    type: source.type,
    enabled: source.enabled !== undefined ? source.enabled : true,
    sort_order: source.sortOrder || 0,
    created_at: now,
    updated_at: now,
  };
  
  await collection.updateOne(
    { key: source.key },
    { 
      $set: doc,
      $setOnInsert: { created_at: now }
    },
    { upsert: true }
  );
}

// 批量保存视频源
export async function saveVodSourcesToDB(sources: VodSource[]) {
  const db = await getDatabase();
  const collection = db.collection<VodSourceDoc>('vod_sources');
  
  // 先清空现有数据
  await collection.deleteMany({});
  
  // 插入新数据
  const now = Math.floor(Date.now() / 1000);
  const docs: VodSourceDoc[] = sources.map((source, index) => ({
    key: source.key,
    name: source.name,
    api: source.api,
    play_url: source.playUrl,
    type: source.type,
    enabled: true,
    sort_order: index,
    created_at: now,
    updated_at: now,
  }));
  
  if (docs.length > 0) {
    await collection.insertMany(docs);
  }
}

// 删除视频源
export async function deleteVodSourceFromDB(key: string) {
  const db = await getDatabase();
  const collection = db.collection<VodSourceDoc>('vod_sources');
  await collection.deleteOne({ key });
}

// 启用/禁用视频源
export async function toggleVodSourceEnabled(key: string, enabled: boolean) {
  const db = await getDatabase();
  const collection = db.collection<VodSourceDoc>('vod_sources');
  const now = Math.floor(Date.now() / 1000);
  
  await collection.updateOne(
    { key },
    { $set: { enabled, updated_at: now } }
  );
}

// 获取选中的视频源
export async function getSelectedVodSourceFromDB(): Promise<VodSource | null> {
  const db = await getDatabase();
  const selectionCollection = db.collection('vod_source_selection');
  const vodSourcesCollection = db.collection<VodSourceDoc>('vod_sources');
  
  // 获取选中的 key
  const selection = await selectionCollection.findOne({ id: 1 }) as { selected_key?: string } | null;
  
  if (selection?.selected_key) {
    const doc = await vodSourcesCollection.findOne({ 
      key: selection.selected_key, 
      enabled: true 
    });
    if (doc) {
      return docToVodSource(doc);
    }
  }
  
  // 如果没有选中的或选中的源不存在，返回第一个启用的源
  const firstDoc = await vodSourcesCollection
    .find({ enabled: true })
    .sort({ sort_order: 1, _id: 1 })
    .limit(1)
    .toArray();
  
  return firstDoc.length > 0 ? docToVodSource(firstDoc[0]) : null;
}

// 保存选中的视频源
export async function saveSelectedVodSourceToDB(key: string) {
  const db = await getDatabase();
  const collection = db.collection('vod_source_selection');
  const now = Math.floor(Date.now() / 1000);
  
  await collection.updateOne(
    { id: 1 },
    { 
      $set: { 
        id: 1,
        selected_key: key, 
        updated_at: now 
      } 
    },
    { upsert: true }
  );
}
