export type GoalStatus = 'active' | 'completed' | 'abandoned';

export interface Goal {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}
